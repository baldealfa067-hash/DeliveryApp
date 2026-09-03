-- ============================================================
-- Etapa 6: Sistema de Motoristas + Tracking
-- ============================================================

-- 1. Tabela de motoristas
CREATE TABLE IF NOT EXISTS public.drivers (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE,
  name text NOT NULL,
  phone text NOT NULL,
  vehicle_type text DEFAULT 'moto' NOT NULL,
  is_available boolean DEFAULT true NOT NULL,
  current_lat double precision,
  current_lng double precision,
  last_location_update timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.drivers DROP CONSTRAINT IF EXISTS drivers_vehicle_type_check;
ALTER TABLE public.drivers ADD CONSTRAINT drivers_vehicle_type_check
  CHECK (vehicle_type IN ('moto', 'bicicleta', 'carro', 'pe'));

CREATE POLICY "Drivers viewable by all"
ON public.drivers FOR SELECT
TO public USING (true);

CREATE POLICY "Drivers manage own profile"
ON public.drivers FOR ALL
TO public
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

GRANT SELECT ON public.drivers TO authenticated;
GRANT ALL ON public.drivers TO service_role;

-- 2. Tabela de entregas
CREATE TABLE IF NOT EXISTS public.deliveries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  restaurant_lat double precision,
  restaurant_lng double precision,
  restaurant_address text,
  customer_lat double precision,
  customer_lng double precision,
  customer_address text,
  driver_id uuid REFERENCES public.drivers(id),
  status text DEFAULT 'pendente' NOT NULL,
  delivery_fee numeric(12,2) DEFAULT 0,
  distance_km double precision,
  accepted_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.deliveries ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.deliveries DROP CONSTRAINT IF EXISTS deliveries_status_check;
ALTER TABLE public.deliveries ADD CONSTRAINT deliveries_status_check
  CHECK (status IN ('pendente', 'aceite', 'recolhido', 'em_entrega', 'entregue', 'cancelado'));

CREATE POLICY "Deliveries viewable by involved"
ON public.deliveries FOR SELECT
TO public
USING (
  driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
  OR order_id IN (
    SELECT id FROM public.orders
    WHERE customer_id = auth.uid()
       OR business_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  )
  OR public.has_role(auth.uid(), 'admin')
);

GRANT SELECT ON public.deliveries TO authenticated;
GRANT ALL ON public.deliveries TO service_role;

-- 3. Tabela de tracking em tempo real
CREATE TABLE IF NOT EXISTS public.delivery_tracking (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  delivery_id uuid NOT NULL REFERENCES public.deliveries(id) ON DELETE CASCADE,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  status text DEFAULT 'em_movimento' NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.delivery_tracking ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.delivery_tracking DROP CONSTRAINT IF EXISTS delivery_tracking_status_check;
ALTER TABLE public.delivery_tracking ADD CONSTRAINT delivery_tracking_status_check
  CHECK (status IN ('parado', 'em_movimento', 'proximo', 'chegou'));

CREATE POLICY "Tracking viewable by involved"
ON public.delivery_tracking FOR SELECT
TO public
USING (
  EXISTS (
    SELECT 1 FROM public.deliveries d
    WHERE d.id = delivery_id
    AND (
      d.driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
      OR d.order_id IN (
        SELECT id FROM public.orders
        WHERE customer_id = auth.uid()
           OR business_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
      )
      OR public.has_role(auth.uid(), 'admin')
    )
  )
);

GRANT SELECT ON public.delivery_tracking TO authenticated;
GRANT ALL ON public.delivery_tracking TO service_role;

-- 4. RPC: Criar perfil de motorista
CREATE OR REPLACE FUNCTION public.register_as_driver(
  p_name text,
  p_phone text,
  p_vehicle_type text DEFAULT 'moto'
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_driver_id uuid;
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN RAISE EXCEPTION 'Nome obrigatório'; END IF;
  IF p_phone IS NULL OR btrim(p_phone) = '' THEN RAISE EXCEPTION 'Telefone obrigatório'; END IF;

  INSERT INTO public.drivers (user_id, name, phone, vehicle_type)
  VALUES (auth.uid(), p_name, p_phone, p_vehicle_type)
  ON CONFLICT (user_id) DO UPDATE
  SET name = p_name, phone = p_phone, vehicle_type = p_vehicle_type, updated_at = now()
  RETURNING id INTO v_driver_id;

  -- Add driver role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (auth.uid(), 'driver')
  ON CONFLICT DO NOTHING;

  RETURN v_driver_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_as_driver(text, text, text) TO authenticated;

-- 5. RPC: Atualizar posição do motorista
CREATE OR REPLACE FUNCTION public.update_driver_location(
  p_lat double precision,
  p_lng double precision
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.drivers
  SET current_lat = p_lat, current_lng = p_lng, last_location_update = now(), updated_at = now()
  WHERE user_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_driver_location(double precision, double precision) TO authenticated;

-- 6. RPC: Criar entrega (quando restaurante clica "Encontrar Motorista")
CREATE OR REPLACE FUNCTION public.create_delivery(
  p_order_id uuid,
  p_restaurant_lat double precision,
  p_restaurant_lng double precision,
  p_restaurant_address text,
  p_customer_lat double precision,
  p_customer_lng double precision,
  p_customer_address text,
  p_distance_km double precision DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_delivery_id uuid;
  v_owner uuid;
BEGIN
  -- Verify the order belongs to the restaurant
  SELECT o.business_id INTO v_owner
  FROM public.orders o
  WHERE o.id = p_order_id
    AND o.business_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid());

  IF v_owner IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado ou sem permissão'; END IF;

  INSERT INTO public.deliveries (
    order_id, restaurant_lat, restaurant_lng, restaurant_address,
    customer_lat, customer_lng, customer_address, distance_km, status
  ) VALUES (
    p_order_id, p_restaurant_lat, p_restaurant_lng, p_restaurant_address,
    p_customer_lat, p_customer_lng, p_customer_address, p_distance_km, 'pendente'
  ) RETURNING id INTO v_delivery_id;

  -- Update order status
  UPDATE public.orders SET status = 'aguardando_motorista', updated_at = now() WHERE id = p_order_id;

  -- Notify available drivers
  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT d.user_id, 'nova_entrega', 'Nova entrega disponível',
         'Toque para aceitar a entrega.', '/painel-motorista'
  FROM public.drivers d
  WHERE d.is_available = true
    AND d.user_id != auth.uid();

  RETURN v_delivery_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_delivery(uuid, double precision, double precision, text, double precision, double precision, text, double precision) TO authenticated;

-- 7. RPC: Motorista aceita entrega
CREATE OR REPLACE FUNCTION public.accept_delivery(p_delivery_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_driver_id uuid;
  v_order_id uuid;
  v_customer_id uuid;
BEGIN
  SELECT id INTO v_driver_id FROM public.drivers WHERE user_id = auth.uid();
  IF v_driver_id IS NULL THEN RAISE EXCEPTION 'Não é motorista registado'; END IF;

  -- Update delivery
  UPDATE public.deliveries
  SET driver_id = v_driver_id, status = 'aceite', accepted_at = now(), updated_at = now()
  WHERE id = p_delivery_id AND status = 'pendente';

  IF NOT FOUND THEN RAISE EXCEPTION 'Entrega não disponível'; END IF;

  -- Get order customer
  SELECT d.order_id, o.customer_id INTO v_order_id, v_customer_id
  FROM public.deliveries d
  JOIN public.orders o ON o.id = d.order_id
  WHERE d.id = p_delivery_id;

  -- Update order
  UPDATE public.orders SET status = 'motorista_encontrado', updated_at = now() WHERE id = v_order_id;

  -- Status history
  INSERT INTO public.order_status_history (order_id, status, note)
  VALUES (v_order_id, 'motorista_encontrado', 'Motorista aceitou a entrega');

  -- Notify customer
  IF v_customer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_customer_id, 'order_update', 'Motorista encontrado', '🛵 Um motorista aceitou a entrega.', '/meus-pedidos');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_delivery(uuid) TO authenticated;

-- 8. RPC: Motorista recolhe pedido
CREATE OR REPLACE FUNCTION public.pickup_delivery(p_delivery_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_customer_id uuid;
BEGIN
  UPDATE public.deliveries
  SET status = 'recolhido', picked_up_at = now(), updated_at = now()
  WHERE id = p_delivery_id
    AND driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
  RETURNING order_id INTO v_order_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Entrega não encontrada'; END IF;

  SELECT customer_id INTO v_customer_id FROM public.orders WHERE id = v_order_id;

  UPDATE public.orders SET status = 'pedido_recolhido', updated_at = now() WHERE id = v_order_id;

  INSERT INTO public.order_status_history (order_id, status)
  VALUES (v_order_id, 'pedido_recolhido');

  IF v_customer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_customer_id, 'order_update', 'Pedido recolhido', '📦 O motorista recolheu o seu pedido.', '/meus-pedidos');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pickup_delivery(uuid) TO authenticated;

-- 9. RPC: Motorista entrega pedido
CREATE OR REPLACE FUNCTION public.complete_delivery(p_delivery_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_customer_id uuid;
BEGIN
  UPDATE public.deliveries
  SET status = 'entregue', delivered_at = now(), updated_at = now()
  WHERE id = p_delivery_id
    AND driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
  RETURNING order_id INTO v_order_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Entrega não encontrada'; END IF;

  SELECT customer_id INTO v_customer_id FROM public.orders WHERE id = v_order_id;

  UPDATE public.orders SET status = 'entregue', updated_at = now() WHERE id = v_order_id;

  INSERT INTO public.order_status_history (order_id, status)
  VALUES (v_order_id, 'entregue');

  IF v_customer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_customer_id, 'order_update', 'Pedido entregue', '✅ Pedido entregue. Bom apetite!', '/meus-pedidos');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_delivery(uuid) TO authenticated;

-- 10. RPC: Obter entregas disponíveis
CREATE OR REPLACE FUNCTION public.get_available_deliveries()
RETURNS TABLE (
  id uuid,
  order_id uuid,
  restaurant_name text,
  restaurant_address text,
  customer_address text,
  distance_km double precision,
  delivery_fee numeric,
  created_at timestamptz
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
         d.created_at
  FROM public.deliveries d
  JOIN public.orders o ON o.id = d.order_id
  JOIN public.profiles p ON p.id = o.business_id
  WHERE d.status = 'pendente'
    AND d.driver_id IS NULL
  ORDER BY d.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_available_deliveries() TO authenticated;

-- 11. RPC: Obter entregas do motorista
CREATE OR REPLACE FUNCTION public.get_my_deliveries()
RETURNS TABLE (
  id uuid,
  order_id uuid,
  order_number integer,
  restaurant_name text,
  restaurant_phone text,
  customer_name text,
  customer_phone text,
  customer_address text,
  distance_km double precision,
  delivery_fee numeric,
  status text,
  accepted_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_driver_id uuid;
BEGIN
  SELECT id INTO v_driver_id FROM public.drivers WHERE user_id = auth.uid();
  IF v_driver_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT d.id, d.order_id, o.order_number,
         rp.name as restaurant_name, rp.phone as restaurant_phone,
         o.customer_name, o.customer_phone,
         d.customer_address, d.distance_km, d.delivery_fee,
         d.status, d.accepted_at, d.picked_up_at, d.delivered_at, d.created_at
  FROM public.deliveries d
  JOIN public.orders o ON o.id = d.order_id
  JOIN public.profiles rp ON rp.id = o.business_id
  WHERE d.driver_id = v_driver_id
  ORDER BY d.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_deliveries() TO authenticated;

-- 12. RPC: Obter tracking de uma entrega
CREATE OR REPLACE FUNCTION public.get_delivery_tracking(p_delivery_id uuid)
RETURNS TABLE (
  lat double precision,
  lng double precision,
  status text,
  created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT dt.lat, dt.lng, dt.status, dt.created_at
  FROM public.delivery_tracking dt
  WHERE dt.delivery_id = p_delivery_id
  ORDER BY dt.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_delivery_tracking(uuid) TO authenticated;

-- 13. RPC: Atualizar tracking (motorista)
CREATE OR REPLACE FUNCTION public.update_delivery_tracking(
  p_delivery_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_status text DEFAULT 'em_movimento'
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Verify driver owns this delivery
  IF NOT EXISTS (
    SELECT 1 FROM public.deliveries
    WHERE id = p_delivery_id
      AND driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
      AND status IN ('aceite', 'recolhido')
  ) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  INSERT INTO public.delivery_tracking (delivery_id, lat, lng, status)
  VALUES (p_delivery_id, p_lat, p_lng, p_status);

  -- Update driver location too
  UPDATE public.drivers
  SET current_lat = p_lat, current_lng = p_lng, last_location_update = now(), updated_at = now()
  WHERE user_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_delivery_tracking(uuid, double precision, double precision, text) TO authenticated;

-- 14. RPC: Toggle disponibilidade do motorista
CREATE OR REPLACE FUNCTION public.toggle_driver_availability()
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_new_state boolean;
BEGIN
  UPDATE public.drivers
  SET is_available = NOT is_available, updated_at = now()
  WHERE user_id = auth.uid()
  RETURNING is_available INTO v_new_state;
  RETURN v_new_state;
END;
$$;

GRANT EXECUTE ON FUNCTION public.toggle_driver_availability() TO authenticated;

-- 15. RPC: Obter pedidos do restaurante para entrega
CREATE OR REPLACE FUNCTION public.get_delivery_orders(p_business_id uuid)
RETURNS TABLE (
  order_id uuid,
  order_number integer,
  customer_name text,
  customer_address text,
  total numeric,
  status text,
  created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT o.id, o.order_number, o.customer_name, o.address,
         o.total, o.status, o.created_at
  FROM public.orders o
  WHERE o.business_id = p_business_id
    AND o.consumption_option = 'entrega'
    AND o.status IN ('pronto', 'aguardando_motorista')
  ORDER BY o.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_delivery_orders(uuid) TO authenticated;

-- 16. Realtime
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.drivers; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.deliveries; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.delivery_tracking; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
