-- Share only the current delivery's map data with the customer who placed it.
CREATE FUNCTION public.get_customer_delivery_map(p_order_id uuid)
RETURNS TABLE (
  pickup_lat double precision, pickup_lng double precision,
  destination_lat double precision, destination_lng double precision,
  driver_lat double precision, driver_lng double precision
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT
    coalesce(o.pickup_lat, d.restaurant_lat),
    coalesce(o.pickup_lng, d.restaurant_lng),
    coalesce(o.customer_lat, d.customer_lat),
    coalesce(o.customer_lng, d.customer_lng),
    dr.current_lat,
    dr.current_lng
  FROM public.orders o
  LEFT JOIN LATERAL (
    SELECT item.*
    FROM public.deliveries item
    WHERE item.order_id = o.id
    ORDER BY item.accepted_at DESC NULLS LAST, item.created_at DESC, item.id DESC
    LIMIT 1
  ) d ON true
  LEFT JOIN public.drivers dr ON dr.id = d.driver_id
    AND d.status IN ('aceite', 'recolhido')
    AND o.status IN ('motorista_encontrado', 'pedido_recolhido', 'a_caminho')
    AND dr.last_location_update >= d.accepted_at
    AND dr.last_location_update >= now() - interval '2 minutes'
  WHERE o.id = p_order_id
    AND o.customer_id = (SELECT auth.uid())
    AND (o.kind = 'envio' OR o.consumption_option = 'entrega')
    AND o.status NOT IN ('cancelado', 'concluido');
$$;

REVOKE ALL ON FUNCTION public.get_customer_delivery_map(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_delivery_map(uuid) TO authenticated;
