-- FASE 2.3 -- as quatro accoes do fecho de caixa.
--
--   frota:       declarar  -> cancelar (enquanto ninguem respondeu)
--   restaurante: confirmar -> liquida o ledger
--                contestar -> a divida fica de pe, com o motivo registado
--
-- AUTORIZACAO: cada RPC verifica o papel a partir do `auth.uid()`, nunca de um
-- parametro. §46 -- a seguranca vive no backend, e um id de frota que chegasse
-- por parametro era so uma sugestao do cliente.

-- ---------------------------------------------------------------------------
-- 1. A frota declara
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.declare_cash_settlement(
  p_business_id uuid,
  p_amount      numeric,
  p_dia         date DEFAULT NULL,
  p_note        text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_fleet_id  uuid;
  v_divida    numeric;
  v_aberto    numeric;
  v_id        uuid;
  v_dono      uuid;
  v_nome      text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessao'; END IF;

  SELECT id INTO v_fleet_id FROM public.fleets WHERE owner_user_id = auth.uid();
  IF v_fleet_id IS NULL THEN
    RAISE EXCEPTION 'So o dono de uma frota pode declarar um fecho de caixa';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Valor invalido';
  END IF;

  SELECT user_id, name INTO v_dono, v_nome
  FROM public.profiles WHERE id = p_business_id;
  IF v_dono IS NULL THEN RAISE EXCEPTION 'Restaurante nao encontrado'; END IF;

  v_divida := public.divida_comida_em_aberto(v_fleet_id, p_business_id);

  -- Ja declarado e por responder conta como comprometido: senao a frota
  -- declarava 10.000 tres vezes seguidas sobre a mesma divida de 10.000 e, se o
  -- restaurante confirmasse as tres, liquidava 30.000. O teto e a divida menos
  -- o que ja esta em cima da mesa.
  SELECT COALESCE(SUM(amount), 0) INTO v_aberto
  FROM public.cash_settlements
  WHERE fleet_id = v_fleet_id AND business_id = p_business_id AND status = 'declarado';

  IF p_amount > v_divida - v_aberto THEN
    RAISE EXCEPTION
      'Valor acima do que esta em divida: deve % FCFA e ja tem % FCFA por confirmar',
      round(v_divida, 2), round(v_aberto, 2);
  END IF;

  INSERT INTO public.cash_settlements (
    fleet_id, business_id, dia, amount, status, note, declared_by)
  VALUES (
    v_fleet_id, p_business_id, COALESCE(p_dia, current_date), p_amount,
    'declarado', p_note, auth.uid())
  RETURNING id INTO v_id;

  -- §35: o restaurante tem de saber que ha dinheiro a confirmar, senao o acerto
  -- fica parado a espera de alguem que nao sabe que tem de agir.
  INSERT INTO public.notifications (
    user_id, type, title, body, link, reference_type, reference_id)
  VALUES (v_dono, 'fecho_caixa',
          'Fecho de caixa por confirmar',
          'A frota declarou ter entregue ' || round(p_amount)::text ||
          ' FCFA em dinheiro. Confirme se recebeu, ou conteste.',
          '/painel-loja', 'settlement', v_id);

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.declare_cash_settlement(uuid, numeric, date, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.declare_cash_settlement(uuid, numeric, date, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. O restaurante confirma -- e so aqui o ledger mexe
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_cash_settlement(p_settlement_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  a        record;
  v_divida numeric;
  v_frota  uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessao'; END IF;

  -- FOR UPDATE: dois toques no botao ao mesmo tempo chegavam os dois aqui com
  -- status 'declarado' e escreviam a liquidacao duas vezes. O segundo espera, le
  -- a linha ja confirmada e cai no RAISE abaixo. O indice unico por
  -- (entry_type, settlement_id) e a segunda rede, no ledger.
  SELECT * INTO a FROM public.cash_settlements WHERE id = p_settlement_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Fecho de caixa nao encontrado'; END IF;

  IF NOT public.is_business_owner(a.business_id) THEN
    RAISE EXCEPTION 'So o restaurante a quem o dinheiro e devido pode confirmar';
  END IF;

  IF a.status <> 'declarado' THEN
    RAISE EXCEPTION 'Este fecho de caixa ja esta %', a.status;
  END IF;

  -- Revalidar contra a divida VIVA, nao contra a que existia na declaracao: no
  -- meio pode ter havido um cancelamento de pedido que a reduziu (§56 gera
  -- reversoes), e liquidar mais do que se deve poria a conta negativa.
  v_divida := public.divida_comida_em_aberto(a.fleet_id, a.business_id);
  IF a.amount > v_divida THEN
    RAISE EXCEPTION
      'A divida mudou desde a declaracao: sao agora % FCFA e este acerto e de % FCFA. Peca a frota para declarar de novo.',
      round(v_divida, 2), round(a.amount, 2);
  END IF;

  UPDATE public.cash_settlements
  SET status = 'confirmado', resolved_by = auth.uid(), resolved_at = now()
  WHERE id = p_settlement_id AND status = 'declarado';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'O fecho de caixa mudou de estado entretanto';
  END IF;

  -- PARTIDA DOBRADA (§30). Duas linhas, sinais opostos:
  --   frota:       negativa -> a divida dela desce
  --   restaurante: positiva -> o que tem a receber desce
  INSERT INTO public.ledger_entries (
    entry_type, account_kind, counterparty,
    fleet_id, business_id, settlement_id, amount, note, created_by)
  VALUES (
    'entrega_dinheiro', 'fleet', 'business',
    a.fleet_id, a.business_id, a.id, -a.amount,
    'Fecho de caixa de ' || a.dia::text || ' confirmado pelo restaurante', auth.uid());

  INSERT INTO public.ledger_entries (
    entry_type, account_kind, counterparty,
    fleet_id, business_id, settlement_id, amount, note, created_by)
  VALUES (
    'recebimento_dinheiro', 'business', 'fleet',
    a.fleet_id, a.business_id, a.id, a.amount,
    'Fecho de caixa de ' || a.dia::text || ' confirmado', auth.uid());

  SELECT owner_user_id INTO v_frota FROM public.fleets WHERE id = a.fleet_id;
  IF v_frota IS NOT NULL THEN
    INSERT INTO public.notifications (
      user_id, type, title, body, link, reference_type, reference_id)
    VALUES (v_frota, 'fecho_caixa',
            'Fecho de caixa confirmado',
            'O restaurante confirmou ter recebido ' || round(a.amount)::text ||
            ' FCFA. A divida foi liquidada.',
            '/painel-frota', 'settlement', a.id);
  END IF;

  RETURN jsonb_build_object(
    'settlement_id', a.id,
    'liquidado', a.amount,
    'divida_restante', public.divida_comida_em_aberto(a.fleet_id, a.business_id)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.confirm_cash_settlement(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.confirm_cash_settlement(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. O restaurante contesta -- a divida fica de pe
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contest_cash_settlement(
  p_settlement_id uuid, p_reason text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  a       record;
  v_frota uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessao'; END IF;
  IF btrim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'Diga porque contesta -- a frota precisa de saber o que corrigir';
  END IF;

  SELECT * INTO a FROM public.cash_settlements WHERE id = p_settlement_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Fecho de caixa nao encontrado'; END IF;

  IF NOT public.is_business_owner(a.business_id) THEN
    RAISE EXCEPTION 'So o restaurante a quem o dinheiro e devido pode contestar';
  END IF;
  IF a.status <> 'declarado' THEN
    RAISE EXCEPTION 'Este fecho de caixa ja esta %', a.status;
  END IF;

  UPDATE public.cash_settlements
  SET status = 'contestado', contest_reason = btrim(p_reason),
      resolved_by = auth.uid(), resolved_at = now()
  WHERE id = p_settlement_id AND status = 'declarado';

  -- NAO se escreve nada no ledger: contestar nao e um facto financeiro, e a
  -- ausencia de liquidacao ja deixa a divida onde estava. §56 -- so entra no
  -- ledger o que aconteceu de facto.
  SELECT owner_user_id INTO v_frota FROM public.fleets WHERE id = a.fleet_id;
  IF v_frota IS NOT NULL THEN
    INSERT INTO public.notifications (
      user_id, type, title, body, link, reference_type, reference_id)
    VALUES (v_frota, 'fecho_caixa',
            'Fecho de caixa contestado',
            'O restaurante contestou os ' || round(a.amount)::text ||
            ' FCFA declarados: ' || btrim(p_reason),
            '/painel-frota', 'settlement', a.id);
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.contest_cash_settlement(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.contest_cash_settlement(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. A frota retira a declaracao, enquanto ninguem respondeu
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_cash_settlement(p_settlement_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  a record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessao'; END IF;

  SELECT * INTO a FROM public.cash_settlements WHERE id = p_settlement_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Fecho de caixa nao encontrado'; END IF;

  IF NOT public.owns_fleet(a.fleet_id) THEN
    RAISE EXCEPTION 'So a frota que declarou pode retirar a declaracao';
  END IF;
  IF a.status <> 'declarado' THEN
    RAISE EXCEPTION 'Este fecho de caixa ja esta % e nao se retira', a.status;
  END IF;

  UPDATE public.cash_settlements
  SET status = 'cancelado', resolved_by = auth.uid(), resolved_at = now()
  WHERE id = p_settlement_id AND status = 'declarado';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_cash_settlement(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cancel_cash_settlement(uuid) TO authenticated;
