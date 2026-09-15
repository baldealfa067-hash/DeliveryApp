-- Versao 20260914192904 = hora real da aplicacao (apply_migration).
--
-- FASE 6 -- as entradas do ledger nascem sozinhas (§25, §26, §28, §56, §73).
--
-- POR TRIGGER EM `orders`, e nao dentro das funcoes. Ha TRES caminhos que
-- levam um pedido a `concluido`: complete_delivery (o motorista confirma),
-- update_order_status (o restaurante conclui) e a valvula do admin. Remendar as
-- funcoes uma a uma deixava sempre uma a nao escrever no ledger, em silencio --
-- e' exactamente a razao por que `dispatch_attempt_aceite` tambem e' trigger.
--
-- MEDIDO contra o exemplo de §27 (comida 10.000 + entrega 1.000):
--   comissao_restaurante  business deve a platform     500  base 10000 taxa 5
--   comissao_frota        fleet    deve a platform      50  base  1000 taxa 5
--   divida_comida         fleet    deve a business   10000
--   credito_comida        business tem a receber    -10000
--   plataforma recebe 550 -- o numero exacto de §27

CREATE OR REPLACE FUNCTION public.ledger_registar_conclusao(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_business_id   uuid;
  v_total         numeric;
  v_fleet_id      uuid;
  v_delivery_fee  numeric;
  v_payment       text;
  v_delivery_id   uuid;
  v_driver_id     uuid;
  v_rate          numeric;
BEGIN
  SELECT o.business_id, COALESCE(o.total,0), o.fleet_id,
         COALESCE(o.delivery_fee,0), COALESCE(o.payment_method,'entrega')
  INTO v_business_id, v_total, v_fleet_id, v_delivery_fee, v_payment
  FROM public.orders o WHERE o.id = p_order_id;

  IF v_business_id IS NULL THEN RETURN; END IF;

  SELECT d.id, d.driver_id INTO v_delivery_id, v_driver_id
  FROM public.deliveries d WHERE d.order_id = p_order_id;

  -- A taxa e lida UMA vez, aqui, e fica gravada em cada linha. A partir deste
  -- momento mudar platform_settings nao toca nestas entradas (§84).
  SELECT COALESCE(NULLIF(value,'')::numeric, 5) INTO v_rate
  FROM public.platform_settings WHERE key = 'commission_rate';
  v_rate := COALESCE(v_rate, 5);

  -- 1. Comissao do restaurante sobre a comida (§25). `orders.total` e SO a
  -- comida -- a taxa de entrega vive em `delivery_fee` desde a Fase 3 -- por
  -- isso nao ha aqui risco de cobrar ao restaurante 5% do que e da frota.
  IF v_total > 0 THEN
    INSERT INTO public.ledger_entries (
      entry_type, account_kind, counterparty, business_id, order_id,
      delivery_id, amount, base_amount, rate, note)
    VALUES ('comissao_restaurante','business','platform', v_business_id, p_order_id,
            v_delivery_id, ROUND(v_total * v_rate / 100, 0), v_total, v_rate,
            'Comissao sobre a venda')
    ON CONFLICT (entry_type, order_id) WHERE order_id IS NOT NULL AND reverses_id IS NULL DO NOTHING;
  END IF;

  -- 2. Comissao da frota sobre a taxa de entrega (§26). Nao existia de todo.
  IF v_fleet_id IS NOT NULL AND v_delivery_fee > 0 THEN
    INSERT INTO public.ledger_entries (
      entry_type, account_kind, counterparty, fleet_id, driver_id, order_id,
      delivery_id, amount, base_amount, rate, note)
    VALUES ('comissao_frota','fleet','platform', v_fleet_id, v_driver_id, p_order_id,
            v_delivery_id, ROUND(v_delivery_fee * v_rate / 100, 0), v_delivery_fee, v_rate,
            'Comissao sobre a taxa de entrega')
    ON CONFLICT (entry_type, order_id) WHERE order_id IS NOT NULL AND reverses_id IS NULL DO NOTHING;
  END IF;

  -- 3. Dinheiro na entrega (§28): o cliente paga ao MOTORISTA, que fica com a
  -- taxa e deve a comida ao restaurante. Sentido confirmado em 2026-09-10 --
  -- ja foi trocado uma vez por engano, e trocado mostra "a receber" a quem tem
  -- a entregar. Duas linhas, uma por conta, para nenhum ecra ter de inverter
  -- sinais por sua conta.
  IF v_payment = 'entrega' AND v_fleet_id IS NOT NULL AND v_total > 0 THEN
    INSERT INTO public.ledger_entries (
      entry_type, account_kind, counterparty, fleet_id, business_id, driver_id,
      order_id, delivery_id, amount, base_amount, note)
    VALUES ('divida_comida','fleet','business', v_fleet_id, v_business_id, v_driver_id,
            p_order_id, v_delivery_id, v_total, v_total,
            'Valor da comida recebido em dinheiro pelo motorista')
    ON CONFLICT (entry_type, order_id) WHERE order_id IS NOT NULL AND reverses_id IS NULL DO NOTHING;

    INSERT INTO public.ledger_entries (
      entry_type, account_kind, counterparty, business_id, fleet_id, driver_id,
      order_id, delivery_id, amount, base_amount, note)
    VALUES ('credito_comida','business','fleet', v_business_id, v_fleet_id, v_driver_id,
            p_order_id, v_delivery_id, -v_total, v_total,
            'Valor da comida a receber da frota')
    ON CONFLICT (entry_type, order_id) WHERE order_id IS NOT NULL AND reverses_id IS NULL DO NOTHING;
  END IF;
END;
$$;

-- Reversao: NUNCA apagar, sempre uma linha nova que anula (§56).
CREATE OR REPLACE FUNCTION public.ledger_reverter_pedido(p_order_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.ledger_entries (
    entry_type, account_kind, counterparty, business_id, fleet_id, driver_id,
    order_id, delivery_id, amount, base_amount, rate, reverses_id, note)
  SELECT 'reversao', e.account_kind, e.counterparty, e.business_id, e.fleet_id,
         e.driver_id, e.order_id, e.delivery_id, -e.amount, e.base_amount, e.rate,
         e.id, p_motivo
  FROM public.ledger_entries e
  WHERE e.order_id = p_order_id
    AND e.reverses_id IS NULL
    -- so o que ainda nao foi revertido: correr isto duas vezes nao duplica
    AND NOT EXISTS (
      SELECT 1 FROM public.ledger_entries r WHERE r.reverses_id = e.id
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_ledger_por_estado_do_pedido()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'concluido' AND OLD.status IS DISTINCT FROM 'concluido' THEN
    PERFORM public.ledger_registar_conclusao(NEW.id);

  ELSIF NEW.status = 'cancelado' AND OLD.status IS DISTINCT FROM 'cancelado' THEN
    -- Um pedido cancelado DEPOIS de concluido (correccao operacional do admin)
    -- ja tem entradas escritas. Anulam-se; nao se apagam.
    PERFORM public.ledger_reverter_pedido(NEW.id, 'Pedido cancelado');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ledger_por_estado_do_pedido ON public.orders;
CREATE TRIGGER ledger_por_estado_do_pedido
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_ledger_por_estado_do_pedido();

-- Internas: quem as chama e o trigger, que ja sabe o contexto. Revogar dos DOIS
-- (regra de 20260910033308).
REVOKE EXECUTE ON FUNCTION public.ledger_registar_conclusao(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ledger_reverter_pedido(uuid, text) FROM PUBLIC, anon, authenticated;
