CREATE OR REPLACE FUNCTION public.apply_partner_order_action(p_token text, p_order_id uuid, p_action text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_owner uuid;
  v_target text;
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub text := current_setting('request.jwt.claim.sub', true);
BEGIN
  SELECT o.* INTO v_order FROM public.order_sync_connections c
  JOIN public.orders o ON o.business_id = c.business_id AND o.created_at >= c.start_at
  WHERE length(p_token) = 64 AND c.token_hash = sha256(convert_to(p_token, 'UTF8'))
    AND c.active AND o.id = p_order_id AND o.source = 'app' FOR UPDATE OF o;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido indisponível' USING ERRCODE = '42501'; END IF;

  v_target := CASE p_action
    WHEN 'accepted' THEN 'confirmado' WHEN 'preparing' THEN 'em_preparacao' WHEN 'ready' THEN 'pronto'
    WHEN 'completed' THEN 'concluido' WHEN 'cancelled' THEN 'cancelado'
  END;
  IF v_target IS NULL THEN RAISE EXCEPTION 'Ação inválida' USING ERRCODE = '22023'; END IF;

  -- Redelivery of the same action after a timeout returns the authoritative state.
  IF public.partner_order_status(v_order.status) = p_action OR v_order.status IN (
    'aguardando_motorista','motorista_encontrado','pedido_recolhido','a_caminho','saiu_para_entrega','concluido','cancelado'
  ) THEN RETURN public.partner_order_status(v_order.status); END IF;
  IF p_action = 'completed' THEN
    IF v_order.status IS DISTINCT FROM 'pronto' OR v_order.consumption_option IS DISTINCT FROM 'para_levar' THEN
      RETURN public.partner_order_status(v_order.status);
    END IF;
  ELSIF p_action = 'cancelled' THEN
    IF v_order.status NOT IN ('novo', 'confirmado', 'em_preparacao', 'na_cozinha', 'pronto')
      OR v_order.payment_status = 'validado' THEN
      RETURN public.partner_order_status(v_order.status);
    END IF;
  ELSIF p_action IS DISTINCT FROM (CASE public.partner_order_status(v_order.status)
    WHEN 'new' THEN 'accepted' WHEN 'accepted' THEN 'preparing' WHEN 'preparing' THEN 'ready' END)
  THEN RETURN public.partner_order_status(v_order.status); END IF;

  SELECT user_id INTO v_owner FROM public.profiles WHERE id = v_order.business_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Restaurante sem responsável'; END IF;
  -- Scope the existing authorization, history and dispatch routines to this owner/order.
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner)::text, true);
  IF p_action = 'completed' AND v_order.payment_status IS DISTINCT FROM 'validado' THEN
    PERFORM public.validate_order_payment(v_order.id, 'validado');
  END IF;
  PERFORM public.update_order_status(v_order.id, v_target, 'Atualizado pela integração do restaurante', NULL);
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  PERFORM set_config('request.jwt.claims', coalesce(v_claims, '{}'), true);
  RETURN (SELECT public.partner_order_status(status) FROM public.orders WHERE id = v_order.id);
END;
$$;
