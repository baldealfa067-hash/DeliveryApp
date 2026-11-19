-- Preserve the delivery coordinates when present and recover missing pairs from the source records.
CREATE OR REPLACE FUNCTION public.get_my_deliveries()
RETURNS TABLE(id uuid, order_id uuid, order_number integer, restaurant_name text,
              restaurant_phone text, restaurant_address text, customer_name text,
              customer_phone text, customer_address text, distance_km double precision,
              delivery_fee numeric, order_total numeric, items jsonb,
              payment_method text, payment_status text, status text,
              accepted_at timestamp with time zone, picked_up_at timestamp with time zone,
              delivered_at timestamp with time zone, created_at timestamp with time zone,
              restaurant_lat double precision, restaurant_lng double precision,
              customer_lat double precision, customer_lng double precision,
              voice_note_url text, pickup_voice_note_url text,
              restaurant_voice_note_url text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_driver_id uuid;
BEGIN
  SELECT drivers.id INTO v_driver_id FROM public.drivers WHERE user_id = auth.uid();
  IF v_driver_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT d.id, d.order_id, o.order_number,
         COALESCE(rp.name, NULLIF(btrim(d.restaurant_address), ''), 'Ponto de recolha') AS restaurant_name,
         rp.phone AS restaurant_phone,
         d.restaurant_address,
         o.customer_name, o.customer_phone,
         d.customer_address, d.distance_km, d.delivery_fee,
         o.total AS order_total, o.items,
         COALESCE(o.payment_method, 'entrega') AS payment_method,
         COALESCE(o.payment_status, 'pendente') AS payment_status,
         d.status, d.accepted_at, d.picked_up_at, d.delivered_at, d.created_at,
         CASE
           WHEN d.restaurant_lat IS NOT NULL AND d.restaurant_lng IS NOT NULL THEN d.restaurant_lat
           WHEN o.kind = 'envio' THEN o.pickup_lat
           ELSE rp.lat
         END,
         CASE
           WHEN d.restaurant_lat IS NOT NULL AND d.restaurant_lng IS NOT NULL THEN d.restaurant_lng
           WHEN o.kind = 'envio' THEN o.pickup_lng
           ELSE rp.lng
         END,
         CASE WHEN d.customer_lat IS NOT NULL AND d.customer_lng IS NOT NULL THEN d.customer_lat ELSE o.customer_lat END,
         CASE WHEN d.customer_lat IS NOT NULL AND d.customer_lng IS NOT NULL THEN d.customer_lng ELSE o.customer_lng END,
         o.voice_note_url,
         o.pickup_voice_note_url,
         -- So enquanto a entrega esta por concluir, para bater certo com o que a
         -- policy do bucket deixa abrir. Devolver o nome depois de entregue dava
         -- ao painel uma referencia que o Storage ja recusa assinar: um leitor
         -- partido no ecra em vez de nada, que e pior.
         CASE WHEN d.status NOT IN ('entregue', 'cancelado')
              THEN rp.location_voice_url END AS restaurant_voice_note_url
  FROM public.deliveries d
  JOIN public.orders o ON o.id = d.order_id
  LEFT JOIN public.profiles rp ON rp.id = o.business_id
  WHERE d.driver_id = v_driver_id
  ORDER BY d.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_customer_delivery_map(p_order_id uuid)
RETURNS TABLE (
  pickup_lat double precision, pickup_lng double precision,
  destination_lat double precision, destination_lng double precision,
  driver_lat double precision, driver_lng double precision
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT
    CASE
      WHEN d.restaurant_lat IS NOT NULL AND d.restaurant_lng IS NOT NULL THEN d.restaurant_lat
      WHEN o.kind = 'envio' THEN o.pickup_lat
      ELSE p.lat
    END,
    CASE
      WHEN d.restaurant_lat IS NOT NULL AND d.restaurant_lng IS NOT NULL THEN d.restaurant_lng
      WHEN o.kind = 'envio' THEN o.pickup_lng
      ELSE p.lng
    END,
    CASE WHEN d.customer_lat IS NOT NULL AND d.customer_lng IS NOT NULL THEN d.customer_lat ELSE o.customer_lat END,
    CASE WHEN d.customer_lat IS NOT NULL AND d.customer_lng IS NOT NULL THEN d.customer_lng ELSE o.customer_lng END,
    dr.current_lat,
    dr.current_lng
  FROM public.orders o
  LEFT JOIN public.profiles p ON p.id = o.business_id
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
