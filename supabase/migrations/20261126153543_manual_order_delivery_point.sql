-- Preserve the existing pricing, stock and order-transition logic.
ALTER FUNCTION public.create_manual_order(uuid, jsonb, text, text, text, text, text, text, text, boolean)
  RENAME TO create_manual_order_internal;

REVOKE ALL ON FUNCTION public.create_manual_order_internal(uuid, jsonb, text, text, text, text, text, text, text, boolean)
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.create_manual_order(
  p_business_id uuid,
  p_items jsonb,
  p_consumption_option text,
  p_customer_name text DEFAULT NULL,
  p_customer_phone text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_bairro text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_payment_method text DEFAULT 'entrega',
  p_concluir boolean DEFAULT false,
  p_customer_lat double precision DEFAULT NULL,
  p_customer_lng double precision DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_order_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    coalesce(public.is_business_owner(p_business_id), false)
    OR coalesce(public.has_role(auth.uid(), 'admin'), false)
  ) THEN
    RAISE EXCEPTION 'Só o dono do restaurante pode lançar um pedido manual';
  END IF;

  IF p_consumption_option = 'entrega' THEN
    IF p_customer_lat IS NULL OR p_customer_lng IS NULL
      OR NOT (p_customer_lat BETWEEN -90 AND 90 AND p_customer_lng BETWEEN -180 AND 180) THEN
      RAISE EXCEPTION 'Marca o destino da entrega no mapa.';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = p_business_id AND lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180
    ) THEN
      RAISE EXCEPTION 'Configura o ponto de recolha no perfil do restaurante.';
    END IF;
  END IF;

  v_order_id := public.create_manual_order_internal(
    p_business_id, p_items, p_consumption_option, p_customer_name, p_customer_phone,
    p_address, p_bairro, p_notes, p_payment_method, p_concluir
  );

  IF p_consumption_option = 'entrega' THEN
    UPDATE public.orders
    SET customer_lat = p_customer_lat, customer_lng = p_customer_lng
    WHERE id = v_order_id;
  END IF;

  RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_manual_order(uuid, jsonb, text, text, text, text, text, text, text, boolean, double precision, double precision)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_manual_order(uuid, jsonb, text, text, text, text, text, text, text, boolean, double precision, double precision)
  TO authenticated;
