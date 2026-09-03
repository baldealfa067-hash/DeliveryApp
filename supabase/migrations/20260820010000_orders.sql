-- ============================================================
-- Pedidos de Restaurante/Loja (Parte 3) — idempotente
-- ============================================================

-- 1. Tabela de pedidos montados na app (sem pagamento — envio por WhatsApp)
CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  total numeric(12,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  consumption_option text NOT NULL CHECK (consumption_option IN ('comer_no_local', 'para_levar', 'entrega')),
  address text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;

-- Qualquer autenticado pode ver pedidos (dono e admin; leitura geral)
DROP POLICY IF EXISTS "Orders viewable by authenticated" ON public.orders;
CREATE POLICY "Orders viewable by authenticated" ON public.orders
  FOR SELECT TO authenticated USING (true);

-- Admin gere pedidos
DROP POLICY IF EXISTS "Orders admins manage" ON public.orders;
CREATE POLICY "Orders admins manage" ON public.orders
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Escrita apenas via RPC (SECURITY DEFINER) — sem políticas INSERT/UPDATE diretas

-- 2. provider_activity aceita o tipo 'pedido'
ALTER TABLE public.provider_activity
  DROP CONSTRAINT IF EXISTS provider_activity_activity_type_check;
ALTER TABLE public.provider_activity
  ADD CONSTRAINT provider_activity_activity_type_check
  CHECK (activity_type IN ('vista', 'whatsapp', 'call', 'pedido'));

-- 3. RPC que regista o pedido montado + atividade + notificação ao dono
CREATE OR REPLACE FUNCTION public.record_business_order(
  p_business_id uuid,
  p_items jsonb,
  p_total numeric,
  p_consumption_option text,
  p_address text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_business public.profiles%ROWTYPE;
  v_owner uuid;
  v_order_id uuid;
  v_item jsonb;
  v_count integer := 0;
BEGIN
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'Estabelecimento em falta';
  END IF;
  IF p_consumption_option NOT IN ('comer_no_local', 'para_levar', 'entrega') THEN
    RAISE EXCEPTION 'Opção de consumo inválida';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Pedido vazio';
  END IF;
  IF p_total IS NULL OR p_total < 0 THEN
    RAISE EXCEPTION 'Total inválido';
  END IF;
  IF p_consumption_option = 'entrega' AND (p_address IS NULL OR btrim(p_address) = '') THEN
    RAISE EXCEPTION 'Morada de entrega obrigatória';
  END IF;

  SELECT * INTO v_business FROM public.profiles WHERE id = p_business_id;
  IF v_business.id IS NULL THEN
    RAISE EXCEPTION 'Estabelecimento não encontrado';
  END IF;

  -- Validar estrutura dos itens (name, price, qty)
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF (v_item->>'name') IS NULL OR (v_item->>'name') = '' THEN
      RAISE EXCEPTION 'Item sem nome';
    END IF;
    IF (v_item->>'price') IS NULL OR (v_item->>'price')::numeric < 0 THEN
      RAISE EXCEPTION 'Item com preço inválido';
    END IF;
    IF (v_item->>'qty') IS NULL OR (v_item->>'qty')::int <= 0 THEN
      RAISE EXCEPTION 'Item com quantidade inválida';
    END IF;
    v_count := v_count + 1;
  END LOOP;

  INSERT INTO public.orders (business_id, items, total, consumption_option, address)
  VALUES (p_business_id, p_items, p_total, p_consumption_option,
          CASE WHEN p_consumption_option = 'entrega' THEN btrim(p_address) ELSE NULL END)
  RETURNING id INTO v_order_id;

  -- Histórico de atividade (feed em tempo real)
  INSERT INTO public.provider_activity (provider_id, activity_type)
  VALUES (p_business_id, 'pedido');

  -- Notificação ao dono do estabelecimento
  SELECT user_id INTO v_owner FROM public.profiles WHERE id = p_business_id;
  IF v_owner IS NOT NULL AND v_owner IS DISTINCT FROM auth.uid() THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_owner, 'pedido', 'Novo pedido recebido',
            v_count || ' item(s) · total estimado de ' || p_total || ' CFA.',
            '/loja/' || p_business_id);
  END IF;

  RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_business_order(uuid, jsonb, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_business_order(uuid, jsonb, numeric, text, text) TO anon, authenticated;

-- 4. Realtime
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.orders; EXCEPTION WHEN duplicate_object THEN NULL; END $$;