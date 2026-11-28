CREATE OR REPLACE FUNCTION public.list_partner_orders(p_token text, p_after timestamptz, p_after_id uuid)
RETURNS TABLE(id uuid, updated_at timestamptz, payload jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_business_id uuid;
  v_start_at timestamptz;
BEGIN
  SELECT c.business_id, c.start_at INTO v_business_id, v_start_at
  FROM public.order_sync_connections c
  WHERE length(p_token) = 64 AND c.token_hash = sha256(convert_to(p_token, 'UTF8')) AND c.active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Credencial inválida' USING ERRCODE = '42501'; END IF;

  RETURN QUERY SELECT o.id, o.updated_at, jsonb_build_object(
    'id', o.id, 'reference', o.order_number, 'updated_at', o.updated_at,
    'status', public.partner_order_status(o.status), 'subtotal', o.total,
    'delivery_fee', coalesce(o.delivery_fee, 0), 'payment_status', o.payment_status,
    'fulfillment', o.consumption_option,
    'customer_name', CASE WHEN public.partner_order_status(o.status) NOT IN ('completed', 'cancelled')
      THEN left(nullif(btrim(o.customer_name), ''), 120) END,
    'customer_phone', CASE WHEN public.partner_order_status(o.status) NOT IN ('completed', 'cancelled')
      THEN left(nullif(btrim(o.customer_phone), ''), 40) END,
    'items', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'name', i->'name', 'quantity', coalesce(i->'qty', i->'quantity'), 'unit_price', i->'price'
    )), '[]'::jsonb) FROM jsonb_array_elements(o.items) i))
  FROM public.orders o
  WHERE o.business_id = v_business_id AND o.created_at >= v_start_at
    AND o.source = 'app' AND public.partner_order_status(o.status) IS NOT NULL
    AND (p_after IS NULL OR (o.updated_at, o.id) > (p_after, p_after_id))
  ORDER BY o.updated_at, o.id LIMIT 100;
END;
$$;

-- Republish eligible active snapshots to existing partner connections.
UPDATE public.orders o SET updated_at = clock_timestamp()
WHERE o.source = 'app' AND public.partner_order_status(o.status) NOT IN ('completed', 'cancelled')
  AND EXISTS (
    SELECT 1 FROM public.order_sync_connections c
    WHERE c.business_id = o.business_id AND c.active AND o.created_at >= c.start_at
  );
