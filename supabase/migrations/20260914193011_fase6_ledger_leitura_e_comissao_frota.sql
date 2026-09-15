-- Versao 20260914193011 = hora real da aplicacao (apply_migration).
--
-- FASE 6 -- leitura sobre o ledger, e a conta da frota (§26, §31, §32, §53, §84).
--
-- O QUE ISTO SUBSTITUI, e porque: `get_business_commission` e
-- `get_all_commissions` somavam `orders.total` em tempo real e multiplicavam
-- pela taxa ACTUAL. Mudar a comissao de 5% para 6% reescrevia retroactivamente
-- a divida historica de toda a gente, em silencio. Medido depois desta
-- migracao: com a taxa mudada de 5% para 20%, a comissao de um pedido ja
-- concluido ficou nos mesmos 550 FCFA. E' este o teste que prova §84.

-- ---------------------------------------------------------------------------
-- 1. commission_payments aceita frota, nao so restaurante (§26)
-- ---------------------------------------------------------------------------
ALTER TABLE public.commission_payments ADD COLUMN IF NOT EXISTS fleet_id uuid REFERENCES public.fleets(id);
ALTER TABLE public.commission_payments ALTER COLUMN business_id DROP NOT NULL;

ALTER TABLE public.commission_payments DROP CONSTRAINT IF EXISTS commission_payments_uma_conta;
ALTER TABLE public.commission_payments ADD CONSTRAINT commission_payments_uma_conta
  CHECK (num_nonnulls(business_id, fleet_id) = 1);

DROP POLICY IF EXISTS "Business owners read own commission payments" ON public.commission_payments;
CREATE POLICY "Parceiro le os seus pagamentos de comissao"
ON public.commission_payments FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = business_id AND p.user_id = auth.uid())
  OR (fleet_id IS NOT NULL AND public.owns_fleet(fleet_id))
);

DROP POLICY IF EXISTS "Business owners insert own commission payments" ON public.commission_payments;
CREATE POLICY "Parceiro envia o seu comprovativo"
ON public.commission_payments FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = business_id AND p.user_id = auth.uid())
  OR (fleet_id IS NOT NULL AND public.owns_fleet(fleet_id))
);

-- ---------------------------------------------------------------------------
-- 2. Validar um pagamento escreve no ledger (§54)
-- ---------------------------------------------------------------------------
-- O pagamento so' baixa a divida quando o admin valida. Rejeitado, a divida
-- fica -- §54 em texto. E a entrada e' escrita UMA vez: validar duas vezes o
-- mesmo comprovativo nao paga a divida a dobrar (§73).
CREATE OR REPLACE FUNCTION public.validate_commission_payment(p_id uuid, p_status text, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_fleet_id    uuid;
  v_amount      numeric;
  v_antes       text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Apenas administradores';
  END IF;
  IF p_status NOT IN ('validado', 'rejeitado') THEN
    RAISE EXCEPTION 'Estado invalido';
  END IF;

  SELECT status, business_id, fleet_id, amount
  INTO v_antes, v_business_id, v_fleet_id, v_amount
  FROM public.commission_payments WHERE id = p_id;

  IF v_antes IS NULL THEN
    RAISE EXCEPTION 'Pagamento nao encontrado';
  END IF;

  UPDATE public.commission_payments
  SET status = p_status, validated_at = now(), validated_by = auth.uid(),
      note = CASE WHEN p_status = 'rejeitado' THEN p_note ELSE note END
  WHERE id = p_id;

  IF p_status = 'validado'
     AND NOT EXISTS (SELECT 1 FROM public.ledger_entries WHERE payment_id = p_id) THEN
    INSERT INTO public.ledger_entries (
      entry_type, account_kind, counterparty, business_id, fleet_id,
      payment_id, amount, base_amount, note, created_by)
    VALUES ('pagamento_comissao',
            CASE WHEN v_business_id IS NOT NULL THEN 'business' ELSE 'fleet' END,
            'platform', v_business_id, v_fleet_id,
            p_id, -v_amount, v_amount, 'Pagamento de comissao validado', auth.uid());
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.validate_commission_payment(uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.validate_commission_payment(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Conta corrente do restaurante -- agora sobre o ledger
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_business_commission(uuid);
CREATE FUNCTION public.get_business_commission(p_business_id uuid)
RETURNS TABLE(
  total_sales      numeric,
  commission_rate  numeric,
  commission_due   numeric,
  commission_paid  numeric,
  commission_balance numeric,
  food_receivable  numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  SELECT user_id INTO v_owner FROM public.profiles WHERE id = p_business_id;
  IF v_owner IS NULL OR (v_owner IS DISTINCT FROM auth.uid() AND NOT public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT
    -- Vendas: a base sobre que a comissao incidiu, ja liquida de reversoes.
    COALESCE(SUM(CASE WHEN e.entry_type='comissao_restaurante' THEN e.base_amount
                      WHEN e.reverses_id IS NOT NULL AND e.amount > 0 THEN -e.base_amount
                      ELSE 0 END), 0),
    -- A taxa ACTUAL, so para mostrar "a comissao e de X%". NAO entra em conta
    -- nenhuma aqui: as contas saem das linhas.
    (SELECT COALESCE(NULLIF(value,'')::numeric, 5) FROM public.platform_settings WHERE key='commission_rate'),
    COALESCE(SUM(CASE WHEN e.counterparty='platform' AND e.entry_type <> 'pagamento_comissao' THEN e.amount ELSE 0 END), 0),
    COALESCE(-SUM(CASE WHEN e.entry_type='pagamento_comissao' THEN e.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN e.counterparty='platform' THEN e.amount ELSE 0 END), 0),
    -- §28: o que a frota tem a entregar ao restaurante. As linhas sao
    -- negativas (tem a receber); mostra-se em positivo.
    COALESCE(-SUM(CASE WHEN e.counterparty='fleet' THEN e.amount ELSE 0 END), 0)
  FROM public.ledger_entries e
  WHERE e.business_id = p_business_id AND e.account_kind = 'business';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_business_commission(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_business_commission(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Conta corrente da frota -- nova (§32)
-- ---------------------------------------------------------------------------
-- RPC e nao leitura directa de `deliveries`: decisao de 2026-09-10. O ledger em
-- si a frota le directamente (a linha ja e dela), mas o RESUMO sai daqui para o
-- painel nao ter de saber a estrutura de sinais.
CREATE OR REPLACE FUNCTION public.get_fleet_financials()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_fleet_id uuid;
  v_resultado jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessao'; END IF;

  SELECT id INTO v_fleet_id FROM public.fleets WHERE owner_user_id = auth.uid();
  IF v_fleet_id IS NULL THEN RAISE EXCEPTION 'Sem frota'; END IF;

  SELECT jsonb_build_object(
    'fleet_id', v_fleet_id,
    'taxa_actual', (SELECT COALESCE(NULLIF(value,'')::numeric,5) FROM public.platform_settings WHERE key='commission_rate'),
    'entregas_faturadas', (
      SELECT count(*) FROM public.ledger_entries
      WHERE fleet_id = v_fleet_id AND entry_type = 'comissao_frota'),
    'valor_entregas', (
      SELECT COALESCE(SUM(base_amount),0) FROM public.ledger_entries
      WHERE fleet_id = v_fleet_id AND entry_type = 'comissao_frota'),
    'comissao_gerada', (
      SELECT COALESCE(SUM(amount),0) FROM public.ledger_entries
      WHERE fleet_id = v_fleet_id AND account_kind='fleet'
        AND counterparty='platform' AND entry_type <> 'pagamento_comissao'),
    'comissao_paga', (
      SELECT COALESCE(-SUM(amount),0) FROM public.ledger_entries
      WHERE fleet_id = v_fleet_id AND entry_type='pagamento_comissao'),
    'divida_plataforma', (
      SELECT COALESCE(SUM(amount),0) FROM public.ledger_entries
      WHERE fleet_id = v_fleet_id AND account_kind='fleet' AND counterparty='platform'),
    -- §28: o que a frota tem a ENTREGAR ao restaurante. Positivo = deve.
    'divida_restaurantes', (
      SELECT COALESCE(SUM(amount),0) FROM public.ledger_entries
      WHERE fleet_id = v_fleet_id AND account_kind='fleet' AND counterparty='business'),
    'movimentos', COALESCE((
      SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object(
          'id', e.id, 'tipo', e.entry_type, 'contraparte', e.counterparty,
          'valor', e.amount, 'base', e.base_amount, 'taxa', e.rate,
          'pedido', o.order_number, 'nota', e.note, 'quando', e.created_at,
          'revertida', EXISTS (SELECT 1 FROM public.ledger_entries r WHERE r.reverses_id = e.id)
        ) AS x
        FROM public.ledger_entries e
        LEFT JOIN public.orders o ON o.id = e.order_id
        WHERE e.fleet_id = v_fleet_id AND e.account_kind = 'fleet'
        ORDER BY e.created_at DESC LIMIT 50
      ) x), '[]'::jsonb)
  ) INTO v_resultado;

  RETURN v_resultado;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_fleet_financials() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_fleet_financials() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Visao do admin -- as duas contas separadas (§26, §55)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_all_commissions();
CREATE FUNCTION public.get_all_commissions()
RETURNS TABLE(
  account_kind   text,
  account_id     uuid,
  account_name   text,
  total_base     numeric,
  commission_due numeric,
  commission_paid numeric,
  commission_balance numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Apenas administradores';
  END IF;

  RETURN QUERY
  SELECT 'business'::text, p.id, p.name,
         COALESCE(SUM(CASE WHEN e.entry_type='comissao_restaurante' THEN e.base_amount ELSE 0 END),0),
         COALESCE(SUM(CASE WHEN e.entry_type <> 'pagamento_comissao' THEN e.amount ELSE 0 END),0),
         COALESCE(-SUM(CASE WHEN e.entry_type='pagamento_comissao' THEN e.amount ELSE 0 END),0),
         COALESCE(SUM(e.amount),0)
  FROM public.ledger_entries e
  JOIN public.profiles p ON p.id = e.business_id
  WHERE e.account_kind='business' AND e.counterparty='platform'
  GROUP BY p.id, p.name

  UNION ALL

  SELECT 'fleet'::text, f.id, f.name,
         COALESCE(SUM(CASE WHEN e.entry_type='comissao_frota' THEN e.base_amount ELSE 0 END),0),
         COALESCE(SUM(CASE WHEN e.entry_type <> 'pagamento_comissao' THEN e.amount ELSE 0 END),0),
         COALESCE(-SUM(CASE WHEN e.entry_type='pagamento_comissao' THEN e.amount ELSE 0 END),0),
         COALESCE(SUM(e.amount),0)
  FROM public.ledger_entries e
  JOIN public.fleets f ON f.id = e.fleet_id
  WHERE e.account_kind='fleet' AND e.counterparty='platform'
  GROUP BY f.id, f.name

  ORDER BY 7 DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_all_commissions() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_all_commissions() TO authenticated;
