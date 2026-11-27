CREATE TABLE public.order_sync_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  start_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true
);
ALTER TABLE public.order_sync_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_sync_connections FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS orders_business_sync_cursor
  ON public.orders(business_id, updated_at, id) WHERE source = 'app';

CREATE FUNCTION public.partner_order_status(p_status text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE p_status
    WHEN 'novo' THEN 'new' WHEN 'confirmado' THEN 'accepted'
    WHEN 'em_preparacao' THEN 'preparing' WHEN 'na_cozinha' THEN 'preparing'
    WHEN 'pronto' THEN 'ready' WHEN 'aguardando_motorista' THEN 'ready'
    WHEN 'motorista_encontrado' THEN 'in_delivery' WHEN 'saiu_para_entrega' THEN 'in_delivery'
    WHEN 'pedido_recolhido' THEN 'in_delivery' WHEN 'a_caminho' THEN 'in_delivery'
    WHEN 'concluido' THEN 'completed' WHEN 'entregue' THEN 'completed' WHEN 'cancelado' THEN 'cancelled'
  END;
$$;
REVOKE ALL ON FUNCTION public.partner_order_status(text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.list_partner_orders(p_token text, p_after timestamptz, p_after_id uuid)
RETURNS TABLE(id uuid, updated_at timestamptz, payload jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_business_id uuid;
  v_start_at timestamptz;
BEGIN
  SELECT c.business_id, c.start_at INTO v_business_id, v_start_at
  FROM public.order_sync_connections c
  WHERE length(p_token) = 64 AND c.token_hash = sha256(convert_to(p_token, 'UTF8')) AND c.active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Credencial inválida' USING ERRCODE = '42501'; END IF;

  RETURN QUERY SELECT o.id, o.updated_at, jsonb_build_object(
    'id', o.id, 'reference', o.order_number, 'updated_at', o.updated_at,
    'status', public.partner_order_status(o.status), 'subtotal', o.total,
    'delivery_fee', coalesce(o.delivery_fee, 0), 'payment_status', o.payment_status,
    'fulfillment', o.consumption_option,
    'items', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'name', i->'name', 'quantity', coalesce(i->'qty', i->'quantity'), 'unit_price', i->'price'
    )), '[]'::jsonb) FROM jsonb_array_elements(o.items) i))
  FROM public.orders o
  WHERE o.business_id = v_business_id AND o.created_at >= v_start_at
    AND o.source = 'app' AND public.partner_order_status(o.status) IS NOT NULL
    AND (p_after IS NULL OR (o.updated_at, o.id) > (p_after, p_after_id))
  ORDER BY o.updated_at, o.id LIMIT 100;
END;
$$;

CREATE FUNCTION public.apply_partner_order_action(p_token text, p_order_id uuid, p_action text)
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
  END;
  IF v_target IS NULL THEN RAISE EXCEPTION 'Ação inválida' USING ERRCODE = '22023'; END IF;

  -- Redelivery of the same action after a timeout returns the authoritative state.
  IF public.partner_order_status(v_order.status) = p_action OR v_order.status IN (
    'aguardando_motorista','motorista_encontrado','pedido_recolhido','a_caminho','saiu_para_entrega','concluido','cancelado'
  ) THEN RETURN public.partner_order_status(v_order.status); END IF;
  IF p_action IS DISTINCT FROM (CASE public.partner_order_status(v_order.status)
    WHEN 'new' THEN 'accepted' WHEN 'accepted' THEN 'preparing' WHEN 'preparing' THEN 'ready' END)
  THEN RETURN public.partner_order_status(v_order.status); END IF;

  SELECT user_id INTO v_owner FROM public.profiles WHERE id = v_order.business_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Restaurante sem responsável'; END IF;
  -- Scope the existing authorization, history and dispatch routines to this owner/order.
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner)::text, true);
  PERFORM public.update_order_status(v_order.id, v_target, 'Atualizado pela integração do restaurante', NULL);
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  PERFORM set_config('request.jwt.claims', coalesce(v_claims, '{}'), true);
  RETURN (SELECT public.partner_order_status(status) FROM public.orders WHERE id = v_order.id);
END;
$$;

REVOKE ALL ON FUNCTION public.list_partner_orders(text,timestamptz,uuid),
  public.apply_partner_order_action(text,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_partner_orders(text,timestamptz,uuid),
  public.apply_partner_order_action(text,uuid,text) TO anon, authenticated;


CREATE FUNCTION public.touch_partner_order_payment()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER touch_partner_order_payment
BEFORE UPDATE OF payment_status ON public.orders
FOR EACH ROW WHEN (OLD.payment_status IS DISTINCT FROM NEW.payment_status)
EXECUTE FUNCTION public.touch_partner_order_payment();
