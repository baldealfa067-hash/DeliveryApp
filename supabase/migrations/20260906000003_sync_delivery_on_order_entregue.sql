-- Quando o restaurante avança manualmente o pedido para 'entregue' via
-- update_order_status (ex: fallback quando motorista não confirma),
-- a tabela deliveries ficava orphaned em 'recolhido'.
-- Este fix sincroniza a entrega quando o pedido passa a 'entregue'.

CREATE OR REPLACE FUNCTION public.update_order_status(
  p_order_id uuid,
  p_new_status text,
  p_note text DEFAULT NULL,
  p_preparation_time integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_customer_id uuid;
  v_customer_name text;
  v_status_label text;
  v_business_id uuid;
  v_consumption text;
  v_customer_lat double precision;
  v_customer_lng double precision;
  v_customer_address text;
  v_restaurant_lat double precision;
  v_restaurant_lng double precision;
  v_restaurant_address text;
  v_distance_km double precision;
  v_delivery_id uuid;
  v_final_status text := p_new_status;
BEGIN
  IF p_new_status NOT IN ('novo', 'confirmado', 'em_preparacao', 'na_cozinha', 'pronto', 'saiu_para_entrega', 'aguardando_motorista', 'motorista_encontrado', 'pedido_recolhido', 'a_caminho', 'entregue', 'concluido', 'cancelado') THEN
    RAISE EXCEPTION 'Estado inválido';
  END IF;

  SELECT business_id, customer_id, customer_name, consumption_option,
         customer_lat, customer_lng, address
  INTO v_business_id, v_customer_id, v_customer_name, v_consumption,
       v_customer_lat, v_customer_lng, v_customer_address
  FROM public.orders WHERE id = p_order_id;

  -- Auto-criar entrega quando marcado "pronto" e é uma entrega
  IF p_new_status = 'pronto' AND v_consumption = 'entrega' THEN
    IF NOT EXISTS (SELECT 1 FROM public.deliveries WHERE order_id = p_order_id) THEN
      SELECT lat, lng INTO v_restaurant_lat, v_restaurant_lng
      FROM public.profiles WHERE id = v_business_id;

      v_restaurant_address := COALESCE((SELECT name FROM public.profiles WHERE id = v_business_id), '');

      IF v_restaurant_lat IS NOT NULL AND v_restaurant_lng IS NOT NULL
         AND v_customer_lat IS NOT NULL AND v_customer_lng IS NOT NULL THEN

        v_distance_km := 6371 * acos(
          LEAST(1.0, GREATEST(-1.0,
            cos(radians(v_restaurant_lat)) * cos(radians(v_customer_lat)) *
            cos(radians(v_customer_lng) - radians(v_restaurant_lng)) +
            sin(radians(v_restaurant_lat)) * sin(radians(v_customer_lat))
          ))
        );

        INSERT INTO public.deliveries (
          order_id, restaurant_lat, restaurant_lng, restaurant_address,
          customer_lat, customer_lng, customer_address, distance_km, status
        ) VALUES (
          p_order_id, v_restaurant_lat, v_restaurant_lng, v_restaurant_address,
          v_customer_lat, v_customer_lng, COALESCE(v_customer_address, ''),
          round(v_distance_km::numeric, 2), 'pendente'
        ) RETURNING id INTO v_delivery_id;

        INSERT INTO public.notifications (user_id, type, title, body, link)
        SELECT d.user_id, 'nova_entrega', 'Nova entrega disponível',
               'Toque para aceitar a entrega.', '/painel-motorista'
        FROM public.drivers d
        WHERE d.is_available = true;

        v_final_status := 'aguardando_motorista';
      ELSE
        p_note := COALESCE(p_note, '') || ' [Entrega automática não criada: coordenadas em falta]';
      END IF;
    END IF;
  END IF;

  -- Sincronizar tabela deliveries quando pedido é marcado 'entregue' manualmente
  -- (ex: restaurante usa painel como fallback quando motorista não confirma)
  IF p_new_status = 'entregue' AND v_consumption = 'entrega' THEN
    UPDATE public.deliveries
    SET status = 'entregue', delivered_at = COALESCE(delivered_at, now()), updated_at = now()
    WHERE order_id = p_order_id AND status != 'entregue';
  END IF;

  UPDATE public.orders
  SET status = v_final_status,
      updated_at = now(),
      preparation_time = COALESCE(p_preparation_time, preparation_time)
  WHERE id = p_order_id;

  INSERT INTO public.order_status_history (order_id, status, note, created_by)
  VALUES (p_order_id, v_final_status, p_note, auth.uid());

  CASE v_final_status
    WHEN 'confirmado' THEN v_status_label := '✅ O restaurante confirmou o seu pedido.';
    WHEN 'em_preparacao' THEN v_status_label := '🍳 O restaurante começou a preparar o seu pedido.';
    WHEN 'pronto' THEN v_status_label := '🍔 O seu pedido está pronto.';
    WHEN 'saiu_para_entrega' THEN v_status_label := '🛵 O seu pedido saiu para entrega. Aguarde em casa!';
    WHEN 'aguardando_motorista' THEN v_status_label := '🛵 O seu pedido está pronto e à espera de um motorista.';
    WHEN 'motorista_encontrado' THEN v_status_label := '🛵 Um motorista aceitou a entrega.';
    WHEN 'pedido_recolhido' THEN v_status_label := '📦 O motorista recolheu o seu pedido.';
    WHEN 'a_caminho' THEN v_status_label := '📍 O seu pedido está a caminho.';
    WHEN 'entregue' THEN v_status_label := '✅ Pedido entregue. Bom apetite!';
    WHEN 'cancelado' THEN v_status_label := '❌ O pedido foi cancelado.';
    ELSE v_status_label := 'Pedido atualizado: ' || v_final_status;
  END CASE;

  IF v_customer_id IS NOT NULL AND v_customer_id IS DISTINCT FROM auth.uid() THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_customer_id, 'order_update', 'Atualização do pedido', v_status_label, '/meus-pedidos');
  END IF;
END;
$$;
