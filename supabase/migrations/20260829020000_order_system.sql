-- ============================================================
-- Etapa 2: Pedidos de Restaurante — Expansão
-- ============================================================

-- 1. Expandir tabela orders com campos de cliente e gestão
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_id uuid;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_name text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_phone text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS preparation_time integer;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS status text DEFAULT 'novo' NOT NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS order_number serial;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now() NOT NULL;

-- Add constraints
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('novo', 'confirmado', 'em_preparacao', 'na_cozinha', 'pronto', 'aguardando_motorista', 'motorista_encontrado', 'pedido_recolhido', 'a_caminho', 'entregue', 'concluido', 'cancelado'));

-- 2. Tabela de histórico de estados
CREATE TABLE IF NOT EXISTS public.order_status_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  status text NOT NULL,
  note text,
  created_by uuid,
  created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;

-- RLS: envolvidos no pedido podem ver o histórico
CREATE POLICY "Order history viewable by involved"
ON public.order_status_history FOR SELECT
TO public
USING (
  EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_id
    AND (
      o.customer_id = auth.uid()
      OR o.business_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
      OR public.has_role(auth.uid(), 'admin')
    )
  )
);

-- Apenas via RPC para escrever
GRANT SELECT ON public.order_status_history TO authenticated;
GRANT ALL ON public.order_status_history TO service_role;

-- 3. RPC: Criar pedido completo com cliente
CREATE OR REPLACE FUNCTION public.create_order(
  p_business_id uuid,
  p_customer_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_items jsonb,
  p_total numeric,
  p_consumption_option text,
  p_address text DEFAULT NULL,
  p_notes text DEFAULT NULL
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

  -- Validate items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF (v_item->>'name') IS NULL OR (v_item->>'name') = '' THEN RAISE EXCEPTION 'Item sem nome'; END IF;
    IF (v_item->>'price') IS NULL OR (v_item->>'price')::numeric < 0 THEN RAISE EXCEPTION 'Item com preço inválido'; END IF;
    IF (v_item->>'qty') IS NULL OR (v_item->>'qty')::int <= 0 THEN RAISE EXCEPTION 'Item com quantidade inválida'; END IF;
    v_count := v_count + 1;
  END LOOP;

  INSERT INTO public.orders (
    business_id, customer_id, customer_name, customer_phone,
    items, total, consumption_option, address, notes, status
  ) VALUES (
    p_business_id,
    CASE WHEN p_customer_id IS NOT NULL THEN p_customer_id ELSE NULL END,
    p_customer_name,
    p_customer_phone,
    p_items, p_total, p_consumption_option,
    CASE WHEN p_consumption_option = 'entrega' THEN btrim(p_address) ELSE NULL END,
    NULLIF(btrim(p_notes), ''),
    'novo'
  ) RETURNING id INTO v_order_id;

  -- Status history
  INSERT INTO public.order_status_history (order_id, status, created_by)
  VALUES (v_order_id, 'novo', auth.uid());

  -- Activity log
  INSERT INTO public.provider_activity (provider_id, activity_type)
  VALUES (p_business_id, 'pedido');

  -- Notification to restaurant owner
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

REVOKE ALL ON FUNCTION public.create_order(uuid, uuid, text, text, jsonb, numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_order(uuid, uuid, text, text, jsonb, numeric, text, text, text) TO authenticated;

-- 4. RPC: Atualizar estado do pedido
CREATE OR REPLACE FUNCTION public.update_order_status(
  p_order_id uuid,
  p_new_status text,
  p_note text DEFAULT NULL,
  p_preparation_time integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_customer_id uuid;
  v_customer_name text;
  v_status_label text;
BEGIN
  IF p_new_status NOT IN ('novo', 'confirmado', 'em_preparacao', 'na_cozinha', 'pronto', 'aguardando_motorista', 'motorista_encontrado', 'pedido_recolhido', 'a_caminho', 'entregue', 'concluido', 'cancelado') THEN
    RAISE EXCEPTION 'Estado inválido';
  END IF;

  -- Update order
  UPDATE public.orders
  SET status = p_new_status,
      updated_at = now(),
      preparation_time = COALESCE(p_preparation_time, preparation_time)
  WHERE id = p_order_id
  RETURNING customer_id, customer_name INTO v_customer_id, v_customer_name;

  -- Status history
  INSERT INTO public.order_status_history (order_id, status, note, created_by)
  VALUES (p_order_id, p_new_status, p_note, auth.uid());

  -- Status labels for notifications
  CASE p_new_status
    WHEN 'confirmado' THEN v_status_label := '✅ O restaurante confirmou o seu pedido.';
    WHEN 'em_preparacao' THEN v_status_label := '🍳 O restaurante começou a preparar o seu pedido.';
    WHEN 'pronto' THEN v_status_label := '🍔 O seu pedido está pronto.';
    WHEN 'aguardando_motorista' THEN v_status_label := '🛵 A aguardar motorista para entrega.';
    WHEN 'motorista_encontrado' THEN v_status_label := '🛵 Um motorista aceitou a entrega.';
    WHEN 'pedido_recolhido' THEN v_status_label := '📦 O motorista recolheu o seu pedido.';
    WHEN 'a_caminho' THEN v_status_label := '📍 O seu pedido está a caminho.';
    WHEN 'entregue' THEN v_status_label := '✅ Pedido entregue. Bom apetite!';
    WHEN 'cancelado' THEN v_status_label := '❌ O pedido foi cancelado.';
    ELSE v_status_label := 'Pedido atualizado: ' || p_new_status;
  END CASE;

  -- Notify customer
  IF v_customer_id IS NOT NULL AND v_customer_id IS DISTINCT FROM auth.uid() THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_customer_id, 'order_update', 'Atualização do pedido', v_status_label, '/meus-pedidos');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.update_order_status(uuid, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_order_status(uuid, text, text, integer) TO authenticated;

-- 5. RPC: Obter pedidos de um restaurante
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
  updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT o.id, o.order_number, o.customer_name, o.customer_phone,
         o.items, o.total, o.status, o.consumption_option,
         o.address, o.notes, o.preparation_time,
         o.created_at, o.updated_at
  FROM public.orders o
  WHERE o.business_id = p_business_id
    AND (p_status IS NULL OR o.status = p_status)
  ORDER BY o.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_business_orders(uuid, text) TO authenticated;

-- 6. RPC: Obter pedidos de um cliente
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
  updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT o.id, o.order_number, o.business_id,
         p.name as business_name,
         o.items, o.total, o.status, o.consumption_option,
         o.address, o.notes, o.preparation_time,
         o.created_at, o.updated_at
  FROM public.orders o
  JOIN public.profiles p ON p.id = o.business_id
  WHERE o.customer_id = p_customer_id
  ORDER BY o.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_orders(uuid) TO authenticated;

-- 7. RPC: Obter histórico de um pedido
CREATE OR REPLACE FUNCTION public.get_order_history(
  p_order_id uuid
)
RETURNS TABLE (
  status text,
  note text,
  created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT h.status, h.note, h.created_at
  FROM public.order_status_history h
  WHERE h.order_id = p_order_id
  ORDER BY h.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_order_history(uuid) TO authenticated;

-- 8. Realtime for order_status_history
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.order_status_history; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 9. RLS: customers can view their own orders
DROP POLICY IF EXISTS "Orders viewable by authenticated" ON public.orders;
CREATE POLICY "Orders viewable by involved"
ON public.orders FOR SELECT
TO public
USING (
  customer_id = auth.uid()
  OR business_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  OR public.has_role(auth.uid(), 'admin')
);
