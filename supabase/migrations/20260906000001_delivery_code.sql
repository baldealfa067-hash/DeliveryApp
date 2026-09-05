-- Código numérico de 6 dígitos para confirmação de entrega pelo motorista
-- O cliente vê o código no acompanhamento do pedido
-- O motorista digita o código para confirmar que entregou à pessoa certa

-- 1. Coluna na tabela orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_code text;

-- 2. Gerar código para novos pedidos (atualizar create_order)
CREATE OR REPLACE FUNCTION public.create_order(
  p_business_id uuid,
  p_customer_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_items jsonb,
  p_total numeric,
  p_consumption_option text,
  p_address text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_bairro text DEFAULT NULL,
  p_customer_lat double precision DEFAULT NULL,
  p_customer_lng double precision DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_owner uuid;
  v_item jsonb;
  v_count integer := 0;
  v_code text;
BEGIN
  IF p_business_id IS NULL THEN RAISE EXCEPTION 'Estabelecimento em falta'; END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Pedido vazio'; END IF;
  IF p_total IS NULL OR p_total < 0 THEN RAISE EXCEPTION 'Total inválido'; END IF;
  IF p_consumption_option NOT IN ('comer_no_local', 'para_levar', 'entrega') THEN
    RAISE EXCEPTION 'Opção de consumo inválida';
  END IF;
  IF p_consumption_option = 'entrega' AND (p_address IS NULL OR btrim(p_address) = '') THEN
    RAISE EXCEPTION 'Morada de entrega obrigatória';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF (v_item->>'name') IS NULL OR (v_item->>'name') = '' THEN RAISE EXCEPTION 'Item sem nome'; END IF;
    IF (v_item->>'price') IS NULL OR (v_item->>'price')::numeric < 0 THEN RAISE EXCEPTION 'Item com preço inválido'; END IF;
    IF (v_item->>'qty') IS NULL OR (v_item->>'qty')::int <= 0 THEN RAISE EXCEPTION 'Item com quantidade inválida'; END IF;
    v_count := v_count + 1;
  END LOOP;

  -- Gerar código de 6 dígitos único para confirmação de entrega
  v_code := lpad(floor(random() * 1000000)::text, 6, '0');

  INSERT INTO public.orders (
    business_id, customer_id, customer_name, customer_phone,
    items, total, consumption_option, address, notes, status, bairro,
    customer_lat, customer_lng, delivery_code
  ) VALUES (
    p_business_id,
    CASE WHEN p_customer_id IS NOT NULL THEN p_customer_id ELSE NULL END,
    p_customer_name,
    p_customer_phone,
    p_items, p_total, p_consumption_option,
    CASE WHEN p_consumption_option = 'entrega' THEN btrim(p_address) ELSE NULL END,
    NULLIF(btrim(p_notes), ''),
    'novo',
    CASE WHEN p_consumption_option = 'entrega' THEN NULLIF(btrim(p_bairro), '') ELSE NULL END,
    CASE WHEN p_consumption_option = 'entrega' THEN p_customer_lat ELSE NULL END,
    CASE WHEN p_consumption_option = 'entrega' THEN p_customer_lng ELSE NULL END,
    v_code
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_status_history (order_id, status, created_by)
  VALUES (v_order_id, 'novo', auth.uid());

  INSERT INTO public.provider_activity (provider_id, activity_type)
  VALUES (p_business_id, 'pedido');

  SELECT user_id INTO v_owner FROM public.profiles WHERE id = p_business_id;

  IF v_owner IS NOT NULL AND v_owner IS DISTINCT FROM auth.uid() THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_owner, 'novo_pedido', 'Novo pedido recebido',
            v_count || ' item(s) · ' || p_total || ' CFA · ' || p_customer_name,
            '/painel-loja');
  END IF;

  RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_order(
  uuid, uuid, text, text, jsonb, numeric, text, text, text, text, double precision, double precision
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_order(
  uuid, uuid, text, text, jsonb, numeric, text, text, text, text, double precision, double precision
) TO authenticated;

-- 3. Atualizar get_customer_orders para incluir delivery_code
DROP FUNCTION IF EXISTS public.get_customer_orders(uuid);
CREATE OR REPLACE FUNCTION public.get_customer_orders(
  p_customer_id uuid
)
RETURNS TABLE (
  id uuid,
  order_number integer,
  business_id uuid,
  business_name text,
  items jsonb,
  total numeric,
  status text,
  consumption_option text,
  address text,
  notes text,
  preparation_time integer,
  created_at timestamptz,
  updated_at timestamptz,
  bairro text,
  delivery_code text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT o.id, o.order_number, o.business_id,
         p.name as business_name,
         o.items, o.total, o.status, o.consumption_option,
         o.address, o.notes, o.preparation_time,
         o.created_at, o.updated_at, o.bairro, o.delivery_code
  FROM public.orders o
  JOIN public.profiles p ON p.id = o.business_id
  WHERE o.customer_id = p_customer_id
  ORDER BY o.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_orders(uuid) TO authenticated;

-- 4. RPC: Motorista valida código e confirma entrega
CREATE OR REPLACE FUNCTION public.validate_delivery_code(
  p_delivery_id uuid,
  p_code text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_stored_code text;
BEGIN
  -- Verificar que o motorista é dono desta entrega e está em estado recolhido
  SELECT d.order_id INTO v_order_id
  FROM public.deliveries d
  WHERE d.id = p_delivery_id
    AND d.driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
    AND d.status = 'recolhido';

  IF v_order_id IS NULL THEN RETURN false; END IF;

  -- Verificar código
  SELECT delivery_code INTO v_stored_code FROM public.orders WHERE id = v_order_id;

  IF v_stored_code IS NOT NULL AND v_stored_code = btrim(p_code) THEN
    PERFORM public.complete_delivery(p_delivery_id);
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_delivery_code(uuid, text) TO authenticated;

-- 5. Gerar código para pedidos existentes que ainda não têm
UPDATE public.orders
SET delivery_code = lpad(floor(random() * 1000000)::text, 6, '0')
WHERE delivery_code IS NULL;
