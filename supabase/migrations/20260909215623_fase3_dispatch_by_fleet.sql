-- FASE 3 (Frotas) -- dispatch por frota, em vez de broadcast (§34, §46).
--
-- ANTES: ao criar a entrega, notificava
--     FROM public.drivers d WHERE d.is_available = true
-- ou seja, TODOS os motoristas disponiveis da plataforma. Com duas frotas em
-- producao, a Frota A via e podia aceitar entregas da Frota B. Violava §34
-- ("procura operacao elegivel -> Frota -> motoristas disponiveis") e o
-- isolamento de §46.
--
-- DEPOIS: a entrega herda `fleet_id` e `delivery_fee` do pedido, onde ficaram
-- congelados no checkout, e so' os motoristas DESSA frota sao notificados.
--
-- SEM FROTA RESOLVIDA (bairro sem preco, ou pedido legado anterior a esta fase):
-- a entrega e' criada na mesma, com fleet_id NULL, e NINGUEM e' notificado --
-- fica registada uma nota no historico. O pedido nunca se perde (§72), mas
-- tambem nao e' oferecido a' toa: sem frota nao ha operacao elegivel.
--
-- CONSEQUENCIA ACEITE (risco 1 do plano): os motoristas legado com fleet_id
-- NULL deixam de receber dispatch. Estao congelados a' espera de decisao
-- (Aditamento 1.2) -- nao sao apagados, apenas nao recebem ofertas.

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
  v_customer_id uuid;
  v_customer_name text;
  v_status_label text;
  v_business_id uuid;
  v_consumption text;
  v_current_status text;
  v_customer_lat double precision;
  v_customer_lng double precision;
  v_customer_address text;
  v_restaurant_lat double precision;
  v_restaurant_lng double precision;
  v_restaurant_address text;
  v_distance_km double precision;
  v_delivery_id uuid;
  v_final_status text := p_new_status;
  v_is_admin boolean;
  v_is_owner boolean;
  v_is_driver boolean;
  v_is_customer boolean;
  v_allowed text[];
  v_fleet_id uuid;
  v_delivery_fee numeric;
  v_notificados integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sem sessao';
  END IF;

  IF p_new_status NOT IN ('novo', 'confirmado', 'em_preparacao', 'na_cozinha',
                          'pronto', 'saiu_para_entrega', 'aguardando_motorista',
                          'motorista_encontrado', 'pedido_recolhido', 'a_caminho',
                          'concluido', 'cancelado') THEN
    RAISE EXCEPTION 'Estado invalido';
  END IF;

  SELECT business_id, customer_id, customer_name, consumption_option,
         customer_lat, customer_lng, address, status, fleet_id, delivery_fee
  INTO v_business_id, v_customer_id, v_customer_name, v_consumption,
       v_customer_lat, v_customer_lng, v_customer_address, v_current_status,
       v_fleet_id, v_delivery_fee
  FROM public.orders WHERE id = p_order_id;

  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'Pedido inexistente';
  END IF;

  -- ---------------------------------------------------------------------
  -- Quem esta' a chamar
  -- ---------------------------------------------------------------------
  v_is_admin := public.has_role(auth.uid(), 'admin');

  v_is_owner := EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_business_id AND p.user_id = auth.uid()
  );

  v_is_driver := EXISTS (
    SELECT 1 FROM public.deliveries dl
    JOIN public.drivers d ON d.id = dl.driver_id
    WHERE dl.order_id = p_order_id AND d.user_id = auth.uid()
  );

  v_is_customer := (v_customer_id IS NOT NULL AND v_customer_id = auth.uid());

  IF NOT (v_is_admin OR v_is_owner OR v_is_driver OR v_is_customer) THEN
    RAISE EXCEPTION 'Sem autorizacao para alterar este pedido';
  END IF;

  -- ---------------------------------------------------------------------
  -- Disciplina de transicoes (§36). O admin passa por cima, de proposito:
  -- e' a valvula de correccao operacional, e fica registada no historico.
  -- ---------------------------------------------------------------------
  IF NOT v_is_admin THEN
    v_allowed := CASE v_current_status
      WHEN 'novo'                 THEN ARRAY['confirmado', 'cancelado']
      WHEN 'confirmado'           THEN ARRAY['em_preparacao', 'cancelado']
      WHEN 'em_preparacao'        THEN ARRAY['na_cozinha', 'pronto', 'cancelado']
      WHEN 'na_cozinha'           THEN ARRAY['pronto', 'cancelado']
      WHEN 'pronto'               THEN ARRAY['aguardando_motorista', 'concluido', 'cancelado']
      WHEN 'aguardando_motorista' THEN ARRAY['motorista_encontrado', 'cancelado']
      WHEN 'motorista_encontrado' THEN ARRAY['pedido_recolhido', 'cancelado']
      WHEN 'pedido_recolhido'     THEN ARRAY['a_caminho', 'cancelado']
      WHEN 'a_caminho'            THEN ARRAY['concluido']
      WHEN 'saiu_para_entrega'    THEN ARRAY['a_caminho', 'concluido']
      ELSE ARRAY[]::text[]  -- concluido e cancelado sao terminais
    END;

    IF NOT (p_new_status = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'Transicao invalida: % -> %', v_current_status, p_new_status;
    END IF;

    -- O cliente so' pode cancelar, e so' antes de o restaurante confirmar.
    IF v_is_customer AND NOT (v_is_owner OR v_is_driver) THEN
      IF NOT (p_new_status = 'cancelado' AND v_current_status = 'novo') THEN
        RAISE EXCEPTION 'O cliente so pode cancelar um pedido ainda por confirmar';
      END IF;
    END IF;

    -- O motorista so' toca na parte logistica do pedido que lhe foi atribuido.
    IF v_is_driver AND NOT v_is_owner THEN
      IF p_new_status NOT IN ('pedido_recolhido', 'a_caminho', 'concluido') THEN
        RAISE EXCEPTION 'O motorista so pode recolher, seguir e concluir a entrega';
      END IF;
    END IF;
  END IF;

  -- ---------------------------------------------------------------------
  -- A partir daqui o comportamento e' o que ja' existia.
  -- ---------------------------------------------------------------------

  -- Auto-criar entrega quando marcado "pronto" e e' uma entrega
  IF p_new_status = 'pronto' AND v_consumption = 'entrega' THEN
    IF NOT EXISTS (SELECT 1 FROM public.deliveries WHERE order_id = p_order_id) THEN
      SELECT lat, lng INTO v_restaurant_lat, v_restaurant_lng
      FROM public.profiles WHERE id = v_business_id;

      v_restaurant_address := COALESCE((SELECT name FROM public.profiles WHERE id = v_business_id), '');

      IF v_restaurant_lat IS NOT NULL AND v_restaurant_lng IS NOT NULL
         AND v_customer_lat IS NOT NULL AND v_customer_lng IS NOT NULL THEN

        -- Dado analitico (§40). Nao entra no preco (§15).
        v_distance_km := 6371 * acos(
          LEAST(1.0, GREATEST(-1.0,
            cos(radians(v_restaurant_lat)) * cos(radians(v_customer_lat)) *
            cos(radians(v_customer_lng) - radians(v_restaurant_lng)) +
            sin(radians(v_restaurant_lat)) * sin(radians(v_customer_lat))
          ))
        );

        INSERT INTO public.deliveries (
          order_id, restaurant_lat, restaurant_lng, restaurant_address,
          customer_lat, customer_lng, customer_address, distance_km, status,
          fleet_id, delivery_fee
        ) VALUES (
          p_order_id, v_restaurant_lat, v_restaurant_lng, v_restaurant_address,
          v_customer_lat, v_customer_lng, COALESCE(v_customer_address, ''),
          round(v_distance_km::numeric, 2), 'pendente',
          v_fleet_id, v_delivery_fee
        ) RETURNING id INTO v_delivery_id;

        -- §34: a oferta vai para os motoristas DESTA frota, e mais ninguem.
        IF v_fleet_id IS NOT NULL THEN
          INSERT INTO public.notifications (user_id, type, title, body, link)
          SELECT d.user_id, 'nova_entrega', 'Nova entrega disponivel',
                 'Toque para aceitar a entrega.', '/painel-motorista'
          FROM public.drivers d
          WHERE d.is_available = true AND d.fleet_id = v_fleet_id;
          GET DIAGNOSTICS v_notificados = ROW_COUNT;

          IF v_notificados = 0 THEN
            p_note := COALESCE(p_note, '') || ' [Sem motorista disponivel na frota]';
          END IF;
        ELSE
          p_note := COALESCE(p_note, '') || ' [Entrega sem frota atribuida: bairro sem preco definido]';
        END IF;

        INSERT INTO public.order_status_history (order_id, status, note, created_by)
        VALUES (p_order_id, 'pronto', p_note, auth.uid());

        v_final_status := 'aguardando_motorista';
      ELSE
        p_note := COALESCE(p_note, '') || ' [Entrega automatica nao criada: coordenadas em falta]';
      END IF;
    END IF;
  END IF;

  -- Sincronizar deliveries quando o pedido de entrega e' dado por concluido
  -- (fallback quando o motorista nao confirma pela sua propria via).
  IF p_new_status = 'concluido' AND v_consumption = 'entrega' THEN
    UPDATE public.deliveries
    SET status = 'entregue', delivered_at = COALESCE(delivered_at, now()), updated_at = now()
    WHERE order_id = p_order_id AND status <> 'entregue';
  END IF;

  UPDATE public.orders
  SET status = v_final_status,
      updated_at = now(),
      preparation_time = COALESCE(p_preparation_time, preparation_time)
  WHERE id = p_order_id;

  INSERT INTO public.order_status_history (order_id, status, note, created_by)
  VALUES (p_order_id, v_final_status, p_note, auth.uid());

  CASE v_final_status
    WHEN 'confirmado' THEN v_status_label := 'O restaurante confirmou o seu pedido.';
    WHEN 'em_preparacao' THEN v_status_label := 'O restaurante comecou a preparar o seu pedido.';
    WHEN 'pronto' THEN v_status_label := 'O seu pedido esta pronto.';
    WHEN 'saiu_para_entrega' THEN v_status_label := 'O seu pedido saiu para entrega. Aguarde em casa!';
    WHEN 'aguardando_motorista' THEN v_status_label := 'O seu pedido esta pronto e a espera de um motorista.';
    WHEN 'motorista_encontrado' THEN v_status_label := 'Um motorista aceitou a entrega.';
    WHEN 'pedido_recolhido' THEN v_status_label := 'O motorista recolheu o seu pedido.';
    WHEN 'a_caminho' THEN v_status_label := 'O seu pedido esta a caminho.';
    WHEN 'concluido' THEN v_status_label := 'Pedido concluido. Bom apetite!';
    WHEN 'cancelado' THEN v_status_label := 'O pedido foi cancelado.';
    ELSE v_status_label := 'Pedido atualizado: ' || v_final_status;
  END CASE;

  IF v_customer_id IS NOT NULL AND v_customer_id IS DISTINCT FROM auth.uid() THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_customer_id, 'order_update', 'Atualizacao do pedido', v_status_label, '/meus-pedidos');
  END IF;
END;
$$;
