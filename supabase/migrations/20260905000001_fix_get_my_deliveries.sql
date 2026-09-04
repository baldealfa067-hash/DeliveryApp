CREATE OR REPLACE FUNCTION public.get_my_deliveries()
 RETURNS TABLE(id uuid, order_id uuid, order_number integer, restaurant_name text, restaurant_phone text, customer_name text, customer_phone text, customer_address text, distance_km double precision, delivery_fee numeric, status text, accepted_at timestamp with time zone, picked_up_at timestamp with time zone, delivered_at timestamp with time zone, created_at timestamp with time zone)
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
