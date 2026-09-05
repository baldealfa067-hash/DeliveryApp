-- Voice note for delivery directions (customer records audio explaining where to deliver)

-- 1. Add voice_note_url column to orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS voice_note_url text;

-- 2. Update create_order to accept voice_note_url (new param at end, DEFAULT NULL)
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
  p_customer_lng double precision DEFAULT NULL,
  p_voice_note_url text DEFAULT NULL
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

  v_code := lpad(floor(random() * 1000000)::text, 6, '0');

  INSERT INTO public.orders (
    business_id, customer_id, customer_name, customer_phone,
    items, total, consumption_option, address, notes, status, bairro,
    customer_lat, customer_lng, delivery_code, voice_note_url
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
    v_code,
    CASE WHEN p_consumption_option = 'entrega' THEN NULLIF(btrim(p_voice_note_url), '') ELSE NULL END
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

-- The new function has 13 params (added p_voice_note_url), must revoke/grant for new signature
REVOKE ALL ON FUNCTION public.create_order(
  uuid, uuid, text, text, jsonb, numeric, text, text, text, text, double precision, double precision, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_order(
  uuid, uuid, text, text, jsonb, numeric, text, text, text, text, double precision, double precision, text
) TO authenticated;

-- 3. Update get_business_orders to include voice_note_url
DROP FUNCTION IF EXISTS public.get_business_orders(uuid, text);
CREATE OR REPLACE FUNCTION public.get_business_orders(
  p_business_id uuid,
  p_status text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  order_number integer,
  customer_name text,
  customer_phone text,
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
  delivery_code text,
  voice_note_url text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT o.id, o.order_number, o.customer_name, o.customer_phone,
         o.items, o.total, o.status, o.consumption_option,
         o.address, o.notes, o.preparation_time,
         o.created_at, o.updated_at, o.bairro, o.delivery_code, o.voice_note_url
  FROM public.orders o
  WHERE o.business_id = p_business_id
    AND (p_status IS NULL OR o.status = p_status)
  ORDER BY o.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_business_orders(uuid, text) TO authenticated;

-- 4. Update get_customer_orders to include voice_note_url
DROP FUNCTION IF EXISTS public.get_customer_orders(uuid);
CREATE OR REPLACE FUNCTION public.get_customer_orders(
  p_customer_id uuid
)
RETURNS TABLE (
  id uuid,
  order_number integer,
  customer_name text,
  customer_phone text,
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
  delivery_code text,
  voice_note_url text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT o.id, o.order_number, o.customer_name, o.customer_phone,
         o.business_id, p.name as business_name,
         o.items, o.total, o.status, o.consumption_option,
         o.address, o.notes, o.preparation_time,
         o.created_at, o.updated_at, o.bairro, o.delivery_code, o.voice_note_url
  FROM public.orders o
  JOIN public.profiles p ON p.id = o.business_id
  WHERE o.customer_id = p_customer_id
  ORDER BY o.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_orders(uuid) TO authenticated;

-- 5. Update get_available_deliveries to include voice_note_url
DROP FUNCTION IF EXISTS public.get_available_deliveries();
CREATE OR REPLACE FUNCTION public.get_available_deliveries()
RETURNS TABLE (
  id uuid,
  order_id uuid,
  restaurant_name text,
  restaurant_address text,
  customer_address text,
  distance_km double precision,
  delivery_fee numeric,
  created_at timestamptz,
  restaurant_lat double precision,
  restaurant_lng double precision,
  voice_note_url text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE user_id = auth.uid() AND is_available = true) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT d.id, d.order_id,
         p.name as restaurant_name,
         d.restaurant_address,
         d.customer_address,
         d.distance_km,
         d.delivery_fee,
         d.created_at,
         d.restaurant_lat,
         d.restaurant_lng,
         o.voice_note_url
  FROM public.deliveries d
  JOIN public.orders o ON o.id = d.order_id
  JOIN public.profiles p ON p.id = o.business_id
  WHERE d.status = 'pendente'
    AND d.driver_id IS NULL
  ORDER BY d.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_available_deliveries() TO authenticated;

-- 6. Update get_my_deliveries to include voice_note_url
DROP FUNCTION IF EXISTS public.get_my_deliveries();
CREATE OR REPLACE FUNCTION public.get_my_deliveries()
RETURNS TABLE (
  id uuid,
  order_id uuid,
  order_number integer,
  restaurant_name text,
  restaurant_phone text,
  restaurant_address text,
  customer_name text,
  customer_phone text,
  customer_address text,
  distance_km double precision,
  delivery_fee numeric,
  status text,
  accepted_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz,
  restaurant_lat double precision,
  restaurant_lng double precision,
  customer_lat double precision,
  customer_lng double precision,
  voice_note_url text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_driver_id uuid;
BEGIN
  SELECT drivers.id INTO v_driver_id FROM public.drivers WHERE user_id = auth.uid();
  IF v_driver_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT d.id, d.order_id, o.order_number,
         rp.name as restaurant_name, rp.phone as restaurant_phone,
         d.restaurant_address,
         o.customer_name, o.customer_phone,
         d.customer_address, d.distance_km, d.delivery_fee,
         d.status, d.accepted_at, d.picked_up_at, d.delivered_at, d.created_at,
         d.restaurant_lat, d.restaurant_lng,
         d.customer_lat, d.customer_lng,
         o.voice_note_url
  FROM public.deliveries d
  JOIN public.orders o ON o.id = d.order_id
  JOIN public.profiles rp ON rp.id = o.business_id
  WHERE d.driver_id = v_driver_id
  ORDER BY d.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_deliveries() TO authenticated;
