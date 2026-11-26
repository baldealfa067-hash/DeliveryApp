-- Older proofs remain readable. Only photos verified by the new RPC can
-- advance an active delivery.
ALTER TABLE public.delivery_proofs
  ADD COLUMN stage text NOT NULL DEFAULT 'delivery' CHECK (stage IN ('pickup', 'delivery')),
  ADD COLUMN gps_verified_at timestamptz;

REVOKE INSERT, UPDATE, DELETE ON public.delivery_proofs FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tg_exige_prova_de_entrega()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_stage text;
BEGIN
  IF NEW.consumption_option <> 'entrega' OR OLD.status = NEW.status
    OR auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  v_stage := CASE
    WHEN NEW.status = 'concluido' THEN 'delivery'
    WHEN NEW.status IN ('pedido_recolhido', 'a_caminho') THEN 'pickup'
  END;
  IF v_stage IS NOT NULL AND NOT EXISTS (
    SELECT FROM public.delivery_proofs p
    JOIN public.deliveries d ON d.id = p.delivery_id AND d.driver_id = p.driver_id
    WHERE p.order_id = NEW.id AND d.order_id = NEW.id AND p.stage = v_stage
      AND p.gps_verified_at IS NOT NULL AND p.photo_url IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Confirma esta etapa com uma fotografia no local.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.submit_gps_delivery_photo(p_delivery_id uuid, p_stage text, p_photo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v record;
  v_lat double precision;
  v_lng double precision;
  v_distance double precision;
  v_image bytea;
BEGIN
  IF p_stage IS NULL OR p_stage NOT IN ('pickup', 'delivery') THEN
    RAISE EXCEPTION 'Etapa inválida.';
  END IF;
  IF p_photo IS NULL OR length(p_photo) NOT BETWEEN 101 AND 3500000
    OR p_photo !~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$' THEN
    RAISE EXCEPTION 'Fotografia inválida.';
  END IF;

  v_image := decode(split_part(p_photo, ',', 2), 'base64');
  IF substring(v_image FROM 1 FOR 3) <> decode('ffd8ff', 'hex')
    OR substring(v_image FROM length(v_image) - 1 FOR 2) <> decode('ffd9', 'hex') THEN
    RAISE EXCEPTION 'Fotografia inválida.';
  END IF;

  SELECT d.id, d.order_id, d.driver_id, d.status, d.restaurant_lat, d.restaurant_lng,
         d.customer_lat, d.customer_lng, o.kind, o.status AS order_status,
         o.pickup_lat, o.pickup_lng, o.customer_lat AS order_lat, o.customer_lng AS order_lng,
         p.lat AS shop_lat, p.lng AS shop_lng, p.user_id AS shop_user,
         dr.current_lat, dr.current_lng, dr.last_location_update
    INTO v
  FROM public.deliveries d
  JOIN public.orders o ON o.id = d.order_id
  JOIN public.drivers dr ON dr.id = d.driver_id
  LEFT JOIN public.profiles p ON p.id = o.business_id
  WHERE d.id = p_delivery_id AND dr.user_id = auth.uid()
  FOR UPDATE OF d, o;

  IF NOT FOUND THEN RAISE EXCEPTION 'Entrega não encontrada.'; END IF;

  -- A retry after a successful transition must not insert or notify twice.
  IF EXISTS (SELECT FROM public.delivery_proofs p WHERE p.delivery_id = v.id
    AND p.driver_id = v.driver_id AND p.stage = p_stage AND p.gps_verified_at IS NOT NULL) THEN
    RETURN;
  END IF;

  IF p_stage = 'pickup' AND v.status = 'aceite' AND v.order_status = 'motorista_encontrado' THEN
    IF v.restaurant_lat IS NOT NULL AND v.restaurant_lng IS NOT NULL THEN
      v_lat := v.restaurant_lat;
      v_lng := v.restaurant_lng;
    ELSIF v.kind = 'envio' THEN
      v_lat := v.pickup_lat;
      v_lng := v.pickup_lng;
    ELSE
      v_lat := v.shop_lat;
      v_lng := v.shop_lng;
    END IF;
  ELSIF p_stage = 'delivery' AND v.status IN ('recolhido', 'em_entrega')
      AND v.order_status IN ('pedido_recolhido', 'a_caminho') THEN
    IF v.customer_lat IS NOT NULL AND v.customer_lng IS NOT NULL THEN
      v_lat := v.customer_lat;
      v_lng := v.customer_lng;
    ELSE
      v_lat := v.order_lat;
      v_lng := v.order_lng;
    END IF;
  ELSE
    RAISE EXCEPTION 'Esta etapa já não está disponível.';
  END IF;

  IF v_lat IS NULL OR v_lng IS NULL OR NOT (abs(v_lat) <= 90 AND abs(v_lng) <= 180) THEN
    RAISE EXCEPTION 'O ponto desta etapa não tem coordenadas válidas no mapa.';
  END IF;
  IF v.current_lat IS NULL OR v.current_lng IS NULL OR v.last_location_update IS NULL
    OR v.last_location_update < now() - interval '45 seconds'
    OR NOT (abs(v.current_lat) <= 90 AND abs(v.current_lng) <= 180) THEN
    RAISE EXCEPTION 'Atualiza o GPS antes de enviar a fotografia.';
  END IF;

  v_distance := 6371000 * acos(least(1.0, greatest(-1.0,
    sin(radians(v_lat)) * sin(radians(v.current_lat)) +
    cos(radians(v_lat)) * cos(radians(v.current_lat)) * cos(radians(v_lng - v.current_lng)
  ))));
  IF v_distance > 100 THEN
    RAISE EXCEPTION 'Aproxima-te a 100 metros ou menos do ponto marcado.';
  END IF;

  INSERT INTO public.delivery_proofs (delivery_id, order_id, driver_id, photo_url, stage, gps_verified_at)
  VALUES (v.id, v.order_id, v.driver_id, p_photo, p_stage, now());

  IF p_stage = 'pickup' THEN
    PERFORM public.pickup_delivery(v.id);
  ELSE
    PERFORM public.complete_delivery(v.id);
    IF v.shop_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (v.shop_user, 'order_update', 'Entrega confirmada',
        'A fotografia da entrega está disponível no pedido.', '/painel-loja');
    END IF;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pickup_delivery(uuid), public.complete_delivery(uuid),
  public.create_delivery_proof(uuid, text, boolean), public.validate_delivery_code(uuid, text),
  public.validate_delivery_qr(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_gps_delivery_photo(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_gps_delivery_photo(uuid, text, text) TO authenticated;

CREATE FUNCTION public.get_order_photo_proof(p_order_id uuid, p_stage text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT jsonb_build_object('existe', true, 'tipo', 'foto', 'foto', pr.photo_url,
    'registada_em', coalesce(pr.gps_verified_at, pr.created_at))
  FROM public.orders o
  JOIN public.delivery_proofs pr ON pr.order_id = o.id
  WHERE o.id = p_order_id AND pr.stage = p_stage AND pr.photo_url IS NOT NULL
    AND (p_stage = 'pickup' AND o.customer_id = auth.uid()
      OR p_stage = 'delivery' AND (public.is_business_owner(o.business_id) OR o.customer_id = auth.uid())
      OR public.has_role(auth.uid(), 'admin'))
  ORDER BY pr.created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_order_photo_proof(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_order_photo_proof(uuid, text) TO authenticated;
