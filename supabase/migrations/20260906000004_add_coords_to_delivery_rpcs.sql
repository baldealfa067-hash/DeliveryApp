-- Add coordinates to delivery RPCs for driver map

-- get_available_deliveries: add restaurant_lat, restaurant_lng
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
  restaurant_lng double precision
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
         d.restaurant_lng
  FROM public.deliveries d
  JOIN public.orders o ON o.id = d.order_id
  JOIN public.profiles p ON p.id = o.business_id
  WHERE d.status = 'pendente'
    AND d.driver_id IS NULL
  ORDER BY d.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_available_deliveries() TO authenticated;

-- get_my_deliveries: add restaurant_lat, restaurant_lng, restaurant_address, customer_lat, customer_lng
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
  customer_lng double precision
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
         d.customer_lat, d.customer_lng
  FROM public.deliveries d
  JOIN public.orders o ON o.id = d.order_id
  JOIN public.profiles rp ON rp.id = o.business_id
  WHERE d.driver_id = v_driver_id
  ORDER BY d.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_deliveries() TO authenticated;
