CREATE TABLE public.driver_zone_prices (
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  bairro text NOT NULL CHECK (bairro = btrim(bairro) AND char_length(bairro) BETWEEN 1 AND 100),
  preco numeric(12,2) NOT NULL CHECK (preco BETWEEN 0 AND 9999999999.99),
  PRIMARY KEY (driver_id, bairro)
);

ALTER TABLE public.driver_zone_prices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.driver_zone_prices FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_zone_prices TO authenticated;

CREATE POLICY "Independent drivers manage their zone prices"
ON public.driver_zone_prices FOR ALL TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.drivers d
    WHERE d.id = driver_zone_prices.driver_id AND d.user_id = (SELECT auth.uid()) AND d.fleet_id IS NULL)
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.drivers d
    WHERE d.id = driver_zone_prices.driver_id AND d.user_id = (SELECT auth.uid()) AND d.fleet_id IS NULL)
);

ALTER TABLE public.ledger_entries
  DROP CONSTRAINT ledger_entries_entry_type_check,
  DROP CONSTRAINT ledger_entries_account_kind_check,
  DROP CONSTRAINT ledger_entries_conta_coerente,
  ADD CONSTRAINT ledger_entries_entry_type_check CHECK (entry_type IN (
    'comissao_restaurante', 'comissao_frota', 'comissao_motorista',
    'divida_comida', 'credito_comida', 'divida_entrega', 'credito_entrega',
    'pagamento_comissao', 'entrega_dinheiro', 'recebimento_dinheiro', 'reversao'
  )),
  ADD CONSTRAINT ledger_entries_account_kind_check
    CHECK (account_kind IN ('business', 'fleet', 'platform', 'driver')),
  ADD CONSTRAINT ledger_entries_conta_coerente CHECK (
    (account_kind = 'business' AND business_id IS NOT NULL)
    OR (account_kind = 'fleet' AND fleet_id IS NOT NULL)
    OR (account_kind = 'platform')
    OR (account_kind = 'driver' AND driver_id IS NOT NULL AND fleet_id IS NULL AND business_id IS NULL)
  );

CREATE INDEX ledger_entries_driver_account_idx
  ON public.ledger_entries (driver_id, created_at DESC) WHERE account_kind = 'driver';

CREATE POLICY "Drivers read own ledger account"
ON public.ledger_entries FOR SELECT TO authenticated
USING (
  account_kind = 'driver' AND EXISTS (
    SELECT 1 FROM public.drivers d WHERE d.id = ledger_entries.driver_id AND d.user_id = (SELECT auth.uid())
  )
);

CREATE FUNCTION public.record_independent_driver_commission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_delivery_id uuid;
  v_driver_id uuid;
  v_rate numeric;
  v_cycle smallint;
BEGIN
  SELECT d.id, d.driver_id INTO v_delivery_id, v_driver_id
  FROM public.deliveries d
  JOIN public.drivers driver ON driver.id = d.driver_id
  WHERE d.order_id = NEW.id AND d.status = 'entregue'
    AND d.fleet_id IS NULL AND driver.fleet_id IS NULL
  ORDER BY d.delivered_at DESC NULLS LAST, d.id
  LIMIT 1;

  IF NOT FOUND THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1 FROM public.ledger_entries e
    WHERE e.order_id = NEW.id AND e.entry_type = 'comissao_motorista'
      AND NOT EXISTS (SELECT 1 FROM public.ledger_entries r WHERE r.reverses_id = e.id)
  ) THEN RETURN NEW; END IF;

  SELECT coalesce(max(e.ciclo), 0) + 1 INTO v_cycle
  FROM public.ledger_entries e
  WHERE e.order_id = NEW.id AND e.entry_type = 'comissao_motorista';

  SELECT coalesce(nullif(value, '')::numeric, 5) INTO v_rate
  FROM public.platform_settings WHERE key = 'commission_rate';
  v_rate := coalesce(v_rate, 5);

  INSERT INTO public.ledger_entries (
    entry_type, account_kind, counterparty, driver_id, order_id, delivery_id, amount, base_amount, rate, ciclo
  ) VALUES (
    'comissao_motorista', 'driver', 'platform', v_driver_id, NEW.id, v_delivery_id,
    round(NEW.delivery_fee * v_rate / 100, 0), NEW.delivery_fee, v_rate, v_cycle
  )
  ON CONFLICT (entry_type, order_id, ciclo)
    WHERE order_id IS NOT NULL AND reverses_id IS NULL DO NOTHING;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.record_independent_driver_commission() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER record_independent_driver_commission
AFTER UPDATE OF status ON public.orders
FOR EACH ROW WHEN (
  OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'concluido'
  AND NEW.fleet_id IS NULL AND NEW.delivery_fee > 0
)
EXECUTE FUNCTION public.record_independent_driver_commission();

CREATE FUNCTION public.get_independent_driver_finance()
RETURNS TABLE (taxa_actual numeric, comissao_gerada numeric, saldo_plataforma numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT
    coalesce((SELECT nullif(value, '')::numeric FROM public.platform_settings WHERE key = 'commission_rate'), 5),
    coalesce(sum(l.amount) FILTER (WHERE l.entry_type IN ('comissao_motorista', 'reversao')), 0),
    coalesce(sum(l.amount), 0)
  FROM public.drivers d
  LEFT JOIN public.ledger_entries l
    ON l.driver_id = d.id AND l.account_kind = 'driver' AND l.counterparty = 'platform'
  WHERE d.user_id = (SELECT auth.uid()) AND d.fleet_id IS NULL
  GROUP BY d.id;
$$;
REVOKE ALL ON FUNCTION public.get_independent_driver_finance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_independent_driver_finance() TO authenticated;
