-- Passo 1 do sistema de entrega: coordenadas reais para restaurantes e pedidos

-- 1. Localização do restaurante (definida uma vez em BusinessEdit)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision;

-- 2. Localização do cliente por pedido (capturada no checkout)
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS customer_lat double precision,
  ADD COLUMN IF NOT EXISTS customer_lng double precision;

-- 3. create_order: mesma lógica existente (validações, histórico, notificação),
-- só com 2 parâmetros novos no fim (default NULL, não parte chamadas existentes)
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

  INSERT INTO public.orders (
    business_id, customer_id, customer_name, customer_phone,
    items, total, consumption_option, address, notes, status, bairro,
    customer_lat, customer_lng
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
    CASE WHEN p_consumption_option = 'entrega' THEN p_customer_lng ELSE NULL END
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

-- 4. Função para o restaurante gravar a sua localização
CREATE OR REPLACE FUNCTION public.update_business_location(
  p_lat double precision,
  p_lng double precision
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET lat = p_lat, lng = p_lng
  WHERE id = auth.uid() AND profile_type = 'business';
END;
$$;

REVOKE ALL ON FUNCTION public.update_business_location(double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_business_location(double precision, double precision) TO authenticated;
