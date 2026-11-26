-- A fila usa a tabela de tentativas existente para reservar uma oferta por motorista.
-- A tarifa acordada no checkout continua em delivery_fee. A frota efetiva,
-- usada no acompanhamento e na contabilidade, é determinada na aceitação.
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;

UPDATE public.dispatch_attempts
SET outcome = 'cancelada', resolved_at = now(), note = 'Substituída pela fila única'
WHERE outcome = 'pendente';

ALTER TABLE public.dispatch_attempts DROP CONSTRAINT dispatch_attempts_outcome_check;
ALTER TABLE public.dispatch_attempts ADD CONSTRAINT dispatch_attempts_outcome_check
  CHECK (outcome IN ('pendente', 'aceite', 'expirada', 'sem_motoristas', 'sem_frota', 'cancelada', 'recusada'));

CREATE UNIQUE INDEX dispatch_one_offer_per_driver
  ON public.dispatch_attempts(driver_id) WHERE outcome = 'pendente';
CREATE INDEX dispatch_driver_jobs
  ON public.deliveries(driver_id, accepted_at DESC) WHERE driver_id IS NOT NULL;
CREATE INDEX dispatch_pending_deliveries
  ON public.deliveries(created_at, id) WHERE status = 'pendente' AND driver_id IS NULL;
ALTER TABLE public.deliveries ADD COLUMN dispatch_alerted_at timestamptz,
  ADD COLUMN dispatch_retried_at timestamptz;

CREATE FUNCTION public.dispatch_driver_eligible(p_driver uuid, p_bairro text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.drivers dr
    WHERE dr.id = p_driver AND dr.is_available
      AND dr.last_location_update > statement_timestamp() - interval '2 minutes'
      AND dr.current_lat BETWEEN -90 AND 90 AND dr.current_lng BETWEEN -180 AND 180
      AND NOT EXISTS (
        SELECT 1 FROM public.deliveries d
        WHERE d.driver_id = dr.id AND d.status IN ('aceite', 'recolhido', 'em_entrega')
      )
      AND (
        EXISTS (
          SELECT 1 FROM public.driver_zone_prices z
          WHERE dr.fleet_id IS NULL AND z.driver_id = dr.id
            AND lower(btrim(z.bairro)) = lower(btrim(p_bairro))
        )
        OR EXISTS (
          SELECT 1 FROM public.fleet_zone_prices z
          JOIN public.fleets f ON f.id = z.fleet_id
          WHERE f.id = dr.fleet_id AND f.is_active AND z.is_active
            AND lower(btrim(z.bairro)) = lower(btrim(p_bairro))
        )
      )
  );
$$;

-- Uma chamada Matrix para todos os candidatos do pedido. O segredo opcional
-- ors_api_key fica no Vault. Em caso de falha, a fila continua com distância direta.
CREATE FUNCTION public.dispatch_pickup_times(p_points jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_key text;
  v_result extensions.http_response;
BEGIN
  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets WHERE name = 'ors_api_key' LIMIT 1;
  IF nullif(btrim(v_key), '') IS NULL THEN RETURN NULL; END IF;

  PERFORM set_config('http.curlopt_timeout_ms', '1500', true);
  v_result := extensions.http((
    'POST', 'https://api.heigit.org/openrouteservice/v2/matrix/driving-car',
    ARRAY[ROW('Authorization', v_key)::extensions.http_header],
    'application/json',
    jsonb_build_object(
      'locations', p_points,
      'destinations', jsonb_build_array(jsonb_array_length(p_points) - 1),
      'metrics', jsonb_build_array('duration')
    )::text
  )::extensions.http_request);

  IF v_result.status = 200 THEN RETURN v_result.content::jsonb -> 'durations'; END IF;
  RETURN NULL;
EXCEPTION
  WHEN OTHERS THEN RETURN NULL;
END;
$$;

CREATE FUNCTION public.dispatch_offer_next(p_delivery uuid, p_lat double precision,
  p_lng double precision, p_bairro text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_candidates jsonb;
  v_points jsonb;
  v_times jsonb;
  v_driver public.drivers%ROWTYPE;
  v_candidate record;
BEGIN
  SELECT jsonb_agg(to_jsonb(c) ORDER BY c.km, c.last_job NULLS FIRST, c.id),
         jsonb_agg(jsonb_build_array(c.current_lng, c.current_lat)
           ORDER BY c.km, c.last_job NULLS FIRST, c.id)
  INTO v_candidates, v_points
  FROM (
    SELECT dr.id, dr.current_lng, dr.current_lat,
           (SELECT max(d.accepted_at) FROM public.deliveries d WHERE d.driver_id = dr.id) AS last_job,
           CASE WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
             6371 * acos(least(1.0, greatest(-1.0,
               sin(radians(p_lat)) * sin(radians(dr.current_lat)) +
               cos(radians(p_lat)) * cos(radians(dr.current_lat)) *
               cos(radians(p_lng - dr.current_lng)))))
           END AS km
    FROM public.drivers dr
    WHERE public.dispatch_driver_eligible(dr.id, p_bairro)
      AND NOT EXISTS (
        SELECT 1 FROM public.dispatch_attempts a
        WHERE a.driver_id = dr.id
          AND (a.outcome = 'pendente' OR (
            a.delivery_id = p_delivery AND a.outcome IN ('recusada', 'expirada')
            AND a.resolved_at > greatest(statement_timestamp() - interval '5 minutes',
              (SELECT d.dispatch_retried_at FROM public.deliveries d WHERE d.id = p_delivery))
          ))
      )
    ORDER BY km, last_job NULLS FIRST, dr.id
    LIMIT 12
  ) c;

  IF v_candidates IS NULL THEN RETURN; END IF;
  IF p_lat IS NOT NULL AND p_lng IS NOT NULL AND jsonb_array_length(v_candidates) > 1 THEN
    v_times := public.dispatch_pickup_times(v_points || jsonb_build_array(jsonb_build_array(p_lng, p_lat)));
  END IF;

  -- Até 30 segundos acima do melhor tempo conta como empate.
  FOR v_candidate IN
    WITH scores AS (
      SELECT (item->>'id')::uuid AS id, (item->>'last_job')::timestamptz AS last_job,
             (v_times -> ((ordinality - 1)::integer) ->> 0)::double precision AS eta,
             (item->>'km')::double precision AS km
      FROM jsonb_array_elements(v_candidates) WITH ORDINALITY AS c(item, ordinality)
    ), ranked AS (
      SELECT *, min(eta) OVER () AS best_eta, min(km) OVER () AS best_km FROM scores
    )
    SELECT id FROM ranked
    ORDER BY CASE
       WHEN best_eta IS NOT NULL THEN
         CASE WHEN eta <= best_eta + 30 THEN 0 ELSE eta END
       WHEN km <= best_km + 0.15 THEN 0 ELSE km
    END NULLS LAST, last_job NULLS FIRST, id
  LOOP
    SELECT * INTO v_driver FROM public.drivers
    WHERE id = v_candidate.id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND OR NOT public.dispatch_driver_eligible(v_driver.id, p_bairro) THEN CONTINUE; END IF;

    INSERT INTO public.dispatch_attempts (
      delivery_id, order_id, fleet_id, driver_id, attempt_number, offered_at,
      expires_at, drivers_notified
    )
    SELECT d.id, d.order_id, v_driver.fleet_id, v_driver.id,
           (SELECT coalesce(max(a.attempt_number), 0) + 1 FROM public.dispatch_attempts a WHERE a.delivery_id = d.id),
           clock_timestamp(), clock_timestamp() + interval '30 seconds', 1
    FROM public.deliveries d
    WHERE d.id = p_delivery AND d.status = 'pendente' AND d.driver_id IS NULL
    ON CONFLICT DO NOTHING;

    IF FOUND THEN
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (v_driver.user_id, 'nova_entrega', 'Nova oferta de entrega',
              'Tens 30 segundos para responder à oferta.', '/painel-motorista');
      RETURN;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_stale_dispatch()
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_job record;
  v_processed integer := 0;
  v_deadline timestamptz := clock_timestamp() + interval '4 seconds';
BEGIN
  -- Uma única execução do agendador, inclusive se uma passagem demorar.
  IF NOT pg_try_advisory_xact_lock(6179238401) THEN RETURN 0; END IF;

  FOR v_job IN
    SELECT d.id, d.status, a.id AS attempt_id, a.expires_at, a.driver_id, o.bairro, o.status AS order_status
    FROM public.dispatch_attempts a
    JOIN public.deliveries d ON d.id = a.delivery_id
    JOIN public.orders o ON o.id = d.order_id
    WHERE a.outcome = 'pendente' AND (
      d.status <> 'pendente' OR o.status = 'cancelado' OR a.expires_at <= clock_timestamp()
      OR NOT public.dispatch_driver_eligible(a.driver_id, o.bairro)
    )
    FOR UPDATE OF d SKIP LOCKED
  LOOP
    UPDATE public.dispatch_attempts
    SET outcome = CASE WHEN v_job.status <> 'pendente' OR v_job.order_status = 'cancelado' THEN 'cancelada'
                       WHEN v_job.expires_at <= clock_timestamp() THEN 'expirada'
                       ELSE 'cancelada' END,
        resolved_at = clock_timestamp()
    WHERE id = v_job.attempt_id AND outcome = 'pendente';
  END LOOP;

  FOR v_job IN
    SELECT d.id, d.restaurant_lat, d.restaurant_lng, o.bairro, d.created_at,
           d.dispatch_alerted_at, o.order_number
    FROM public.deliveries d
    JOIN public.orders o ON o.id = d.order_id
    WHERE d.status = 'pendente' AND d.driver_id IS NULL
      AND o.status IN ('pendente', 'pronto', 'aguardando_motorista')
      AND NOT EXISTS (
        SELECT 1 FROM public.dispatch_attempts a
        WHERE a.delivery_id = d.id AND a.outcome = 'pendente'
      )
    ORDER BY d.created_at, d.id
    FOR UPDATE OF d SKIP LOCKED
  LOOP
    IF v_job.dispatch_alerted_at IS NULL AND v_job.created_at < now() - interval '5 minutes' THEN
      UPDATE public.deliveries SET dispatch_alerted_at = now() WHERE id = v_job.id;
      INSERT INTO public.notifications (user_id, type, title, body, link)
      SELECT r.user_id, 'dispatch_expirado', 'Entrega à espera de motorista',
             'O pedido #' || coalesce(v_job.order_number::text, '?') || ' aguarda motorista há mais de 5 minutos.',
             '/admin'
      FROM public.user_roles r WHERE r.role = 'admin';
    END IF;

    PERFORM public.dispatch_offer_next(v_job.id, v_job.restaurant_lat, v_job.restaurant_lng, v_job.bairro);
    v_processed := v_processed + 1;
    EXIT WHEN clock_timestamp() >= v_deadline;
  END LOOP;
  RETURN v_processed;
END;
$$;

DROP FUNCTION public.get_available_deliveries();
CREATE FUNCTION public.get_available_deliveries()
RETURNS TABLE(id uuid, order_id uuid, restaurant_name text, restaurant_address text,
  customer_address text, distance_km double precision, delivery_fee numeric,
  order_total numeric, items jsonb, payment_method text, payment_status text,
  created_at timestamptz, restaurant_lat double precision, restaurant_lng double precision,
  voice_note_url text, pickup_voice_note_url text, offer_expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT d.id, d.order_id, coalesce(p.name, 'Ponto de recolha'), d.restaurant_address,
         d.customer_address, d.distance_km, d.delivery_fee, o.total, o.items,
         coalesce(o.payment_method, 'entrega'), coalesce(o.payment_status, 'pendente'),
         d.created_at, d.restaurant_lat, d.restaurant_lng, o.voice_note_url, o.pickup_voice_note_url,
         a.expires_at
  FROM public.dispatch_attempts a
  JOIN public.drivers dr ON dr.id = a.driver_id
  JOIN public.deliveries d ON d.id = a.delivery_id
  JOIN public.orders o ON o.id = d.order_id
  LEFT JOIN public.profiles p ON p.id = o.business_id
  WHERE dr.user_id = (SELECT auth.uid())
    AND d.status = 'pendente' AND d.driver_id IS NULL
    AND o.status IN ('pendente', 'pronto', 'aguardando_motorista')
    AND a.outcome = 'pendente' AND a.expires_at > statement_timestamp()
    AND public.dispatch_driver_eligible(dr.id, o.bairro);
$$;

CREATE OR REPLACE FUNCTION public.accept_delivery(p_delivery_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_driver public.drivers%ROWTYPE;
  v_delivery public.deliveries%ROWTYPE;
  v_order public.orders%ROWTYPE;
BEGIN
  -- A ordem dos bloqueios acompanha a atualização de estado do pedido.
  SELECT o.* INTO v_order FROM public.orders o
  JOIN public.deliveries d ON d.order_id = o.id
  WHERE d.id = p_delivery_id
    AND EXISTS (
      SELECT 1 FROM public.dispatch_attempts a
      JOIN public.drivers dr ON dr.id = a.driver_id
      WHERE a.delivery_id = d.id AND a.outcome = 'pendente'
        AND a.expires_at > clock_timestamp() AND dr.user_id = (SELECT auth.uid())
    )
  FOR UPDATE OF o;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oferta expirada ou indisponível'; END IF;

  SELECT * INTO v_delivery FROM public.deliveries WHERE id = p_delivery_id FOR UPDATE;
  SELECT * INTO v_driver FROM public.drivers WHERE user_id = (SELECT auth.uid()) FOR UPDATE;

  IF v_delivery.status <> 'pendente' OR v_delivery.driver_id IS NOT NULL
    OR v_order.status NOT IN ('pendente', 'pronto', 'aguardando_motorista')
    OR NOT public.dispatch_driver_eligible(v_driver.id, v_order.bairro)
  THEN RAISE EXCEPTION 'Entrega indisponível'; END IF;

  UPDATE public.dispatch_attempts SET outcome = 'aceite', resolved_at = clock_timestamp()
  WHERE delivery_id = p_delivery_id AND driver_id = v_driver.id
    AND outcome = 'pendente' AND expires_at > clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'Oferta expirada ou indisponível'; END IF;

  UPDATE public.deliveries
  SET driver_id = v_driver.id, fleet_id = v_driver.fleet_id, status = 'aceite',
      accepted_at = clock_timestamp(), updated_at = now()
  WHERE id = p_delivery_id;

  UPDATE public.orders
  SET fleet_id = v_driver.fleet_id, status = 'motorista_encontrado', updated_at = now()
  WHERE id = v_order.id;

  INSERT INTO public.order_status_history (order_id, status, note)
  VALUES (v_order.id, 'motorista_encontrado', 'Motorista aceitou a entrega');
END;
$$;

CREATE FUNCTION public.decline_delivery(p_delivery_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE public.dispatch_attempts a
  SET outcome = 'recusada', resolved_at = clock_timestamp()
  FROM public.drivers dr
  WHERE a.delivery_id = p_delivery_id AND a.driver_id = dr.id
    AND dr.user_id = (SELECT auth.uid())
    AND a.outcome = 'pendente' AND a.expires_at > clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'Oferta expirada ou indisponível'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.reoffer_delivery(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin') OR EXISTS (
      SELECT 1 FROM public.orders o JOIN public.profiles p ON p.id = o.business_id
      WHERE o.id = p_order_id AND p.user_id = auth.uid()
    )
  ) THEN RAISE EXCEPTION 'Sem autorização para reencaminhar este pedido'; END IF;

  UPDATE public.deliveries SET dispatch_retried_at = clock_timestamp()
  WHERE order_id = p_order_id AND status = 'pendente' AND driver_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Não há entrega à espera de motorista'; END IF;

  RETURN jsonb_build_object('queued', true, 'motoristas_notificados', 0);
END;
$$;

-- Atualizar o histórico que ainda descrevia a notificação para toda a frota.
DO $$
DECLARE
  v_function regprocedure;
  v_def text;
BEGIN
  FOR v_function IN
    SELECT p.oid::regprocedure FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('update_order_status', 'create_send_order')
      AND p.prosrc LIKE '%offer_delivery_to_fleet%'
  LOOP
    v_def := pg_get_functiondef(v_function);
    v_def := regexp_replace(v_def,
      '      IF v_fleet_id IS NULL THEN[^;]*;[[:space:]]*ELSIF v_notificados = 0 THEN[^;]*;[[:space:]]*END IF;',
      '      p_note := COALESCE(p_note, '''') || '' [Entrega em fila]'';');
    v_def := replace(v_def,
      '''[Envio criado pelo cliente. '' || v_notificados || '' motorista(s) notificado(s)]''',
      '''[Envio criado pelo cliente e colocado em fila]''');
    v_def := regexp_replace(v_def,
      'v_notificados := public.offer_delivery_to_fleet\(v_delivery_id, 1\);', 'v_notificados := 0;');
    IF v_def LIKE '%offer_delivery_to_fleet(%' THEN
      RAISE EXCEPTION 'Chamada antiga de distribuição em %', v_function;
    END IF;
    EXECUTE v_def;
  END LOOP;
END;
$$;

DROP FUNCTION public.offer_delivery_to_fleet(uuid, integer);

REVOKE ALL ON FUNCTION public.dispatch_driver_eligible(uuid, text),
  public.dispatch_pickup_times(jsonb), public.dispatch_offer_next(uuid, double precision, double precision, text),
  public.expire_stale_dispatch() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_available_deliveries(), public.accept_delivery(uuid),
  public.decline_delivery(uuid), public.reoffer_delivery(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_available_deliveries(), public.accept_delivery(uuid),
  public.decline_delivery(uuid), public.reoffer_delivery(uuid) TO authenticated;

-- A entrega independente tem os mesmos acertos bilaterais de uma entrega
-- de frota, com a conta do motorista como contraparte.
ALTER TABLE public.ledger_entries DROP CONSTRAINT ledger_entries_counterparty_check;
ALTER TABLE public.ledger_entries ADD CONSTRAINT ledger_entries_counterparty_check
  CHECK (counterparty IN ('business', 'fleet', 'platform', 'driver'));

CREATE FUNCTION public.record_independent_delivery_settlement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_delivery record;
  v_amount numeric;
  v_debt_type text;
  v_credit_type text;
  v_debtor text;
BEGIN
  SELECT id, driver_id INTO v_delivery
  FROM public.deliveries
  WHERE order_id = NEW.id AND status = 'entregue' AND fleet_id IS NULL AND driver_id IS NOT NULL
  ORDER BY delivered_at DESC NULLS LAST, id LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF NEW.payment_method = 'online' THEN
    v_amount := coalesce(NEW.delivery_fee, 0);
    v_debt_type := 'divida_entrega';
    v_credit_type := 'credito_entrega';
    v_debtor := 'business';
  ELSE
    v_amount := coalesce(NEW.total, 0);
    v_debt_type := 'divida_comida';
    v_credit_type := 'credito_comida';
    v_debtor := 'driver';
  END IF;
  IF v_amount <= 0 THEN RETURN NEW; END IF;

  INSERT INTO public.ledger_entries (
    entry_type, account_kind, counterparty, driver_id, business_id, order_id,
    delivery_id, amount, base_amount, ciclo
  ) VALUES
    (v_debt_type, v_debtor, CASE WHEN v_debtor = 'driver' THEN 'business' ELSE 'driver' END,
      v_delivery.driver_id, CASE WHEN v_debtor = 'business' THEN NEW.business_id END,
      NEW.id, v_delivery.id, v_amount, v_amount,
      (SELECT coalesce(max(ciclo), 0) + 1 FROM public.ledger_entries WHERE order_id = NEW.id AND entry_type = v_debt_type)),
    (v_credit_type, CASE WHEN v_debtor = 'driver' THEN 'business' ELSE 'driver' END, v_debtor,
      v_delivery.driver_id, CASE WHEN v_debtor = 'driver' THEN NEW.business_id END,
      NEW.id, v_delivery.id, -v_amount, v_amount,
      (SELECT coalesce(max(ciclo), 0) + 1 FROM public.ledger_entries WHERE order_id = NEW.id AND entry_type = v_credit_type));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.record_independent_delivery_settlement() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER record_independent_delivery_settlement
AFTER UPDATE OF status ON public.orders
FOR EACH ROW WHEN (
  OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'concluido'
  AND NEW.fleet_id IS NULL AND NEW.business_id IS NOT NULL
)
EXECUTE FUNCTION public.record_independent_delivery_settlement();

COMMENT ON FUNCTION public.expire_stale_dispatch() IS
  'Processa a fila única, fecha ofertas vencidas e avisa o administrador de entregas atrasadas.';
COMMENT ON FUNCTION public.reoffer_delivery(uuid) IS
  'Reabre a elegibilidade dos motoristas para uma entrega pendente. A fila mantém ofertas ainda válidas.';

SELECT cron.schedule('expirar-dispatch', '10 seconds', 'SELECT public.expire_stale_dispatch();');
