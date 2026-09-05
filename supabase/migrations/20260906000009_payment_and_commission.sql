-- ============================================================
-- Payment system + Platform commission
-- ============================================================

-- 1. Payment number on restaurant profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS payment_number text;

-- 2. Payment fields on orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_method text DEFAULT 'entrega';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_proof_url text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'pendente';

-- 3. Platform settings (admin-only)
CREATE TABLE IF NOT EXISTS public.platform_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read platform settings" ON public.platform_settings
  FOR SELECT TO authenticated USING (true);

-- Only admin can write (enforced via RPC)
GRANT SELECT ON public.platform_settings TO authenticated;
GRANT ALL ON public.platform_settings TO service_role;

-- Insert defaults
INSERT INTO public.platform_settings (key, value) VALUES
  ('commission_rate', '5'),
  ('platform_merchant_code', ''),
  ('platform_payment_number', '')
ON CONFLICT (key) DO NOTHING;

-- RPC: update platform setting (admin only)
CREATE OR REPLACE FUNCTION public.update_platform_setting(p_key text, p_value text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Apenas administradores';
  END IF;
  UPDATE public.platform_settings SET value = p_value, updated_at = now(), updated_by = auth.uid()
  WHERE key = p_key;
  IF NOT FOUND THEN
    INSERT INTO public.platform_settings (key, value, updated_by) VALUES (p_key, p_value, auth.uid());
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_platform_setting(text, text) TO authenticated;

-- 4. Commission payments table
CREATE TABLE IF NOT EXISTS public.commission_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.profiles(id),
  amount numeric NOT NULL,
  proof_url text NOT NULL,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'validado', 'rejeitado')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  validated_at timestamptz,
  validated_by uuid REFERENCES auth.users(id)
);

ALTER TABLE public.commission_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Business owners read own commission payments" ON public.commission_payments
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = business_id AND p.user_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Business owners insert own commission payments" ON public.commission_payments
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = business_id AND p.user_id = auth.uid())
  );

GRANT SELECT, INSERT ON public.commission_payments TO authenticated;
GRANT ALL ON public.commission_payments TO service_role;

-- RPC: validate commission payment (admin only)
CREATE OR REPLACE FUNCTION public.validate_commission_payment(p_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Apenas administradores';
  END IF;
  IF p_status NOT IN ('validado', 'rejeitado') THEN
    RAISE EXCEPTION 'Estado invalido';
  END IF;
  UPDATE public.commission_payments
  SET status = p_status, validated_at = now(), validated_by = auth.uid()
  WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_commission_payment(uuid, text) TO authenticated;

-- 5. RPC: validate order payment (restaurant owner only)
CREATE OR REPLACE FUNCTION public.validate_order_payment(p_order_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  IF p_status NOT IN ('validado', 'rejeitado') THEN
    RAISE EXCEPTION 'Estado invalido';
  END IF;
  SELECT p.user_id INTO v_owner
  FROM public.orders o JOIN public.profiles p ON p.id = o.business_id
  WHERE o.id = p_order_id;
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;
  UPDATE public.orders SET payment_status = p_status WHERE id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_order_payment(uuid, text) TO authenticated;

-- 6. Update create_order to accept payment fields
DROP FUNCTION IF EXISTS public.create_order(uuid, uuid, text, text, jsonb, numeric, text, text, text, text, double precision, double precision, text);

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
  p_voice_note_url text DEFAULT NULL,
  p_payment_method text DEFAULT 'entrega',
  p_payment_proof_url text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_order_number integer;
  v_delivery_code text;
  v_owner_id uuid;
BEGIN
  IF p_customer_name IS NULL OR btrim(p_customer_name) = '' THEN
    RAISE EXCEPTION 'Nome do cliente obrigatorio';
  END IF;
  IF p_customer_phone IS NULL OR btrim(p_customer_phone) = '' THEN
    RAISE EXCEPTION 'Telefone do cliente obrigatorio';
  END IF;
  IF p_total < 0 THEN
    RAISE EXCEPTION 'Total invalido';
  END IF;
  IF p_consumption_option NOT IN ('comer_no_local', 'para_levar', 'entrega') THEN
    RAISE EXCEPTION 'Opcao de consumo invalida';
  END IF;
  IF p_payment_method NOT IN ('entrega', 'online') THEN
    RAISE EXCEPTION 'Metodo de pagamento invalido';
  END IF;

  v_delivery_code := lpad((floor(random() * 1000000))::text, 6, '0');

  SELECT COALESCE(MAX(order_number), 0) + 1 INTO v_order_number FROM public.orders WHERE business_id = p_business_id;

  INSERT INTO public.orders (
    business_id, customer_id, customer_name, customer_phone,
    items, total, status, consumption_option,
    address, notes, order_number, delivery_code,
    bairro, customer_lat, customer_lng, voice_note_url,
    payment_method, payment_proof_url, payment_status
  ) VALUES (
    p_business_id,
    p_customer_id,
    btrim(p_customer_name),
    btrim(p_customer_phone),
    p_items,
    p_total,
    'novo',
    p_consumption_option,
    CASE WHEN p_consumption_option = 'entrega' THEN p_address ELSE NULL END,
    p_notes,
    v_order_number,
    v_delivery_code,
    CASE WHEN p_consumption_option = 'entrega' THEN p_bairro ELSE NULL END,
    CASE WHEN p_consumption_option = 'entrega' THEN p_customer_lat ELSE NULL END,
    CASE WHEN p_consumption_option = 'entrega' THEN p_customer_lng ELSE NULL END,
    CASE WHEN p_consumption_option = 'entrega' THEN p_voice_note_url ELSE NULL END,
    p_payment_method,
    p_payment_proof_url,
    CASE WHEN p_payment_method = 'online' AND p_payment_proof_url IS NOT NULL THEN 'pendente' ELSE 'pendente' END
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_status_history (order_id, status, created_by)
  VALUES (v_order_id, 'novo', p_customer_id);

  -- Record activity
  BEGIN
    INSERT INTO public.provider_activity (provider_id, activity_type)
    VALUES (p_business_id, 'order');
  EXCEPTION WHEN others THEN NULL;
  END;

  -- Notify business owner
  SELECT user_id INTO v_owner_id FROM public.profiles WHERE id = p_business_id;
  IF v_owner_id IS NOT NULL AND v_owner_id IS DISTINCT FROM p_customer_id THEN
    PERFORM public.create_notification(
      v_owner_id,
      'Novo Pedido #' || v_order_number,
      btrim(p_customer_name) || ' fez um pedido de ' || p_total || ' FCFA',
      'order',
      'order',
      v_order_id
    );
  END IF;

  RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_order(uuid, uuid, text, text, jsonb, numeric, text, text, text, text, double precision, double precision, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_order(uuid, uuid, text, text, jsonb, numeric, text, text, text, text, double precision, double precision, text, text, text) TO anon;

-- 7. Update get_business_orders to return payment fields
-- First check what the current signature returns and drop it
DROP FUNCTION IF EXISTS public.get_business_orders(uuid);
DROP FUNCTION IF EXISTS public.get_business_orders(uuid, text);

CREATE OR REPLACE FUNCTION public.get_business_orders(p_business_id uuid, p_status text DEFAULT NULL)
RETURNS TABLE(
  id uuid,
  business_id uuid,
  business_name text,
  customer_id uuid,
  customer_name text,
  customer_phone text,
  items jsonb,
  total numeric,
  status text,
  consumption_option text,
  address text,
  notes text,
  order_number integer,
  preparation_time integer,
  delivery_code text,
  bairro text,
  voice_note_url text,
  payment_method text,
  payment_proof_url text,
  payment_status text,
  created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.id, o.business_id,
    COALESCE(p.name, '') AS business_name,
    o.customer_id, o.customer_name, o.customer_phone,
    o.items, o.total, o.status, o.consumption_option,
    o.address, o.notes, o.order_number, o.preparation_time,
    o.delivery_code, o.bairro, o.voice_note_url,
    COALESCE(o.payment_method, 'entrega') AS payment_method,
    o.payment_proof_url,
    COALESCE(o.payment_status, 'pendente') AS payment_status,
    o.created_at
  FROM public.orders o
  LEFT JOIN public.profiles p ON p.id = o.business_id
  WHERE o.business_id = p_business_id
    AND (p_status IS NULL OR o.status = p_status)
  ORDER BY o.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_business_orders(uuid, text) TO authenticated;

-- 8. Update get_customer_orders to return payment fields
DROP FUNCTION IF EXISTS public.get_customer_orders(uuid);

CREATE OR REPLACE FUNCTION public.get_customer_orders(p_customer_id uuid)
RETURNS TABLE(
  id uuid,
  business_id uuid,
  business_name text,
  customer_id uuid,
  customer_name text,
  customer_phone text,
  items jsonb,
  total numeric,
  status text,
  consumption_option text,
  address text,
  notes text,
  order_number integer,
  preparation_time integer,
  delivery_code text,
  bairro text,
  voice_note_url text,
  payment_method text,
  payment_proof_url text,
  payment_status text,
  created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.id, o.business_id,
    COALESCE(p.name, '') AS business_name,
    o.customer_id, o.customer_name, o.customer_phone,
    o.items, o.total, o.status, o.consumption_option,
    o.address, o.notes, o.order_number, o.preparation_time,
    o.delivery_code, o.bairro, o.voice_note_url,
    COALESCE(o.payment_method, 'entrega') AS payment_method,
    o.payment_proof_url,
    COALESCE(o.payment_status, 'pendente') AS payment_status,
    o.created_at
  FROM public.orders o
  LEFT JOIN public.profiles p ON p.id = o.business_id
  WHERE o.customer_id = p_customer_id
  ORDER BY o.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_orders(uuid) TO authenticated;

-- 9. RPC: get commission summary for a business
CREATE OR REPLACE FUNCTION public.get_business_commission(p_business_id uuid)
RETURNS TABLE(
  total_sales numeric,
  commission_rate numeric,
  commission_due numeric,
  commission_paid numeric,
  commission_balance numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_rate numeric;
  v_sales numeric;
  v_paid numeric;
BEGIN
  SELECT user_id INTO v_owner FROM public.profiles WHERE id = p_business_id;
  IF v_owner IS NULL OR (v_owner <> auth.uid() AND NOT public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  SELECT COALESCE(value::numeric, 5) INTO v_rate FROM public.platform_settings WHERE key = 'commission_rate';

  SELECT COALESCE(SUM(o.total), 0) INTO v_sales
  FROM public.orders o
  WHERE o.business_id = p_business_id
    AND o.status IN ('pronto', 'aguardando_motorista', 'motorista_encontrado', 'pedido_recolhido', 'a_caminho', 'entregue', 'concluido');

  SELECT COALESCE(SUM(cp.amount), 0) INTO v_paid
  FROM public.commission_payments cp
  WHERE cp.business_id = p_business_id AND cp.status = 'validado';

  RETURN QUERY SELECT
    v_sales,
    v_rate,
    ROUND(v_sales * v_rate / 100, 0),
    v_paid,
    ROUND(v_sales * v_rate / 100, 0) - v_paid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_business_commission(uuid) TO authenticated;

-- 10. RPC: admin get all businesses commission summary
CREATE OR REPLACE FUNCTION public.get_all_commissions()
RETURNS TABLE(
  business_id uuid,
  business_name text,
  total_sales numeric,
  commission_due numeric,
  commission_paid numeric,
  commission_balance numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rate numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Apenas administradores';
  END IF;

  SELECT COALESCE(value::numeric, 5) INTO v_rate FROM public.platform_settings WHERE key = 'commission_rate';

  RETURN QUERY
  SELECT
    p.id AS business_id,
    p.name AS business_name,
    COALESCE(SUM(o.total), 0)::numeric AS total_sales,
    ROUND(COALESCE(SUM(o.total), 0) * v_rate / 100, 0)::numeric AS commission_due,
    COALESCE(cp_paid.paid, 0)::numeric AS commission_paid,
    (ROUND(COALESCE(SUM(o.total), 0) * v_rate / 100, 0) - COALESCE(cp_paid.paid, 0))::numeric AS commission_balance
  FROM public.profiles p
  LEFT JOIN public.orders o ON o.business_id = p.id
    AND o.status IN ('pronto', 'aguardando_motorista', 'motorista_encontrado', 'pedido_recolhido', 'a_caminho', 'entregue', 'concluido')
  LEFT JOIN (
    SELECT cp.business_id, SUM(cp.amount) AS paid
    FROM public.commission_payments cp WHERE cp.status = 'validado'
    GROUP BY cp.business_id
  ) cp_paid ON cp_paid.business_id = p.id
  WHERE p.profile_type = 'business'
  GROUP BY p.id, p.name, cp_paid.paid
  HAVING COALESCE(SUM(o.total), 0) > 0
  ORDER BY commission_balance DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_all_commissions() TO authenticated;
