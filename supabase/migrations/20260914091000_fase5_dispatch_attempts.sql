-- FASE 5 (Dispatch) -- registo da tentativa de dispatch, e o cancelamento a
-- fechar tambem a entrega (§34, §72, §73).
--
-- O QUE FALTAVA, medido no codigo actual:
--
-- 1. §34 pede que se registe "qual frota recebeu; qual motorista recebeu;
--    horario; aceitacao; recolha; entrega; cancelamento". Quase tudo isso ja'
--    vive em `deliveries` (fleet_id, driver_id, accepted_at, picked_up_at,
--    delivered_at). O que NAO existia era o registo da OFERTA: a que frota foi
--    oferecida, quando, a quantos motoristas, e em que deu. Isso estava a ser
--    escrito como texto livre numa nota do historico
--    (`[Sem motorista disponivel na frota]`), que nao se consegue consultar nem
--    contar. Passa a haver `dispatch_attempts`.
--
-- 2. Cancelar o pedido deixava a entrega viva. Ver o comentario no corpo da
--    funcao -- era possivel aceitar a entrega de um pedido cancelado.
--
-- PORQUE UMA TABELA E NAO MAIS COLUNAS EM `deliveries`: sao varias tentativas
-- por entrega (a 1a ronda e a re-oferta), e uma linha por entrega nao guarda um
-- historico de rondas sem se repetir em colunas numeradas. §39 manda distinguir
-- dado registado de metrica calculada: aqui regista-se o evento, e quem quiser
-- taxa de aceitacao conta-a depois.
--
-- NAO SE ACRESCENTA ESTADO NOVO A `deliveries`. O CHECK continua
-- ('pendente','aceite','recolhido','em_entrega','entregue','cancelado'). Uma
-- entrega cuja oferta expirou continua `pendente` DE PROPOSITO: um motorista que
-- fique disponivel tarde ainda a pode aceitar, o que e' melhor do que tranca-la.
-- O que muda com a expiracao e' que deixa de ser silencio -- fica registada em
-- dispatch_attempts e ha' gente notificada (migracao seguinte).

-- ---------------------------------------------------------------------------
-- Tabela
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.dispatch_attempts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id      uuid NOT NULL REFERENCES public.deliveries(id) ON DELETE CASCADE,
  order_id         uuid NOT NULL REFERENCES public.orders(id)     ON DELETE CASCADE,
  -- ON DELETE SET NULL e nao CASCADE: apagar uma frota nao pode apagar o
  -- historico de dispatch dela (§56).
  fleet_id         uuid REFERENCES public.fleets(id)  ON DELETE SET NULL,
  driver_id        uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  attempt_number   integer NOT NULL DEFAULT 1,
  offered_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  drivers_notified integer NOT NULL DEFAULT 0,
  outcome          text NOT NULL DEFAULT 'pendente',
  resolved_at      timestamptz,
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dispatch_attempts DROP CONSTRAINT IF EXISTS dispatch_attempts_outcome_check;
ALTER TABLE public.dispatch_attempts ADD CONSTRAINT dispatch_attempts_outcome_check
  CHECK (outcome IN ('pendente', 'aceite', 'expirada', 'sem_motoristas', 'sem_frota', 'cancelada'));

-- Uma entrega nao pode ter duas ofertas abertas ao mesmo tempo. E' isto que
-- torna a expiracao idempotente (§72): correr o job duas vezes nao abre duas
-- rondas.
CREATE UNIQUE INDEX IF NOT EXISTS dispatch_attempts_uma_aberta_por_entrega
  ON public.dispatch_attempts (delivery_id) WHERE outcome = 'pendente';

CREATE INDEX IF NOT EXISTS dispatch_attempts_por_expirar
  ON public.dispatch_attempts (expires_at) WHERE outcome = 'pendente';

CREATE INDEX IF NOT EXISTS dispatch_attempts_order_id ON public.dispatch_attempts (order_id);
CREATE INDEX IF NOT EXISTS dispatch_attempts_fleet_id ON public.dispatch_attempts (fleet_id);

COMMENT ON TABLE public.dispatch_attempts IS
  'Registo das rondas de oferta de uma entrega a uma frota (§34): a quem foi '
  'oferecida, quando, a quantos motoristas, e em que deu. Escrita apenas por '
  'funcoes SECURITY DEFINER -- nao ha policy de INSERT/UPDATE para ninguem.';

ALTER TABLE public.dispatch_attempts ENABLE ROW LEVEL SECURITY;

-- Leitura: o dono do restaurante do pedido, e o admin. O dono da FROTA fica de
-- fora da tabela de proposito, pela mesma decisao de 2026-09-10 que deixou
-- `deliveries` fechada a frota -- ela chega aos seus dados pelas RPCs. Nao ha
-- policy de escrita nenhuma: so' as funcoes SECURITY DEFINER escrevem aqui.
DROP POLICY IF EXISTS "Dispatch attempts viewable by business owner and admin" ON public.dispatch_attempts;
CREATE POLICY "Dispatch attempts viewable by business owner and admin"
ON public.dispatch_attempts FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.profiles p ON p.id = o.business_id
    WHERE o.id = dispatch_attempts.order_id AND p.user_id = auth.uid()
  )
);

GRANT SELECT ON public.dispatch_attempts TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.dispatch_attempts FROM anon, authenticated;

-- Definicoes configuraveis pelo admin (§24 ja' usa esta tabela para a comissao).
INSERT INTO public.platform_settings (key, value) VALUES
  ('dispatch_timeout_minutes', '10'),
  ('dispatch_max_attempts',    '2')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Oferecer uma entrega a' frota dela, e registar a ronda
-- ---------------------------------------------------------------------------
--
-- Chamada dos DOIS sitios que oferecem: update_order_status (1a ronda, quando o
-- restaurante marca "pronto") e expire_stale_dispatch (2a ronda). Uma so'
-- funcao para as duas rondas nao divergirem no que notificam nem no que
-- registam.
--
-- NAO E' PARA SER CHAMADA POR UTILIZADORES. Nao verifica autorizacao nenhuma
-- porque nao e' um ponto de entrada: quem a chama ja' verificou. Por isso o
-- EXECUTE e' revogado a anon E a authenticated -- so' corre dentro de outra
-- SECURITY DEFINER, ou pelo dono da base. Deixa-la aberta seria dar a qualquer
-- pessoa a capacidade de notificar motoristas de qualquer frota.

CREATE OR REPLACE FUNCTION public.offer_delivery_to_fleet(
  p_delivery_id uuid,
  p_attempt     integer DEFAULT 1
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_fleet_id     uuid;
  v_order_id     uuid;
  v_notificados  integer := 0;
  v_minutos      integer;
  v_outcome      text;
BEGIN
  SELECT d.fleet_id, d.order_id INTO v_fleet_id, v_order_id
  FROM public.deliveries d WHERE d.id = p_delivery_id;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Entrega % nao existe', p_delivery_id;
  END IF;

  SELECT COALESCE(NULLIF(value, '')::integer, 10) INTO v_minutos
  FROM public.platform_settings WHERE key = 'dispatch_timeout_minutes';
  v_minutos := COALESCE(v_minutos, 10);

  IF v_fleet_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    SELECT d.user_id, 'nova_entrega', 'Nova entrega disponivel',
           CASE WHEN p_attempt > 1
                THEN 'Entrega ainda por aceitar. Toque para aceitar.'
                ELSE 'Toque para aceitar a entrega.' END,
           '/painel-motorista'
    FROM public.drivers d
    WHERE d.is_available = true AND d.fleet_id = v_fleet_id;
    GET DIAGNOSTICS v_notificados = ROW_COUNT;
  END IF;

  -- O desfecho ja' se sabe agora quando nao ha' a quem oferecer: essas rondas
  -- nascem fechadas, e a expiracao nao tem de lhes tocar.
  v_outcome := CASE
                 WHEN v_fleet_id IS NULL  THEN 'sem_frota'
                 WHEN v_notificados = 0   THEN 'sem_motoristas'
                 ELSE 'pendente'
               END;

  INSERT INTO public.dispatch_attempts (
    delivery_id, order_id, fleet_id, attempt_number,
    expires_at, drivers_notified, outcome, resolved_at
  ) VALUES (
    p_delivery_id, v_order_id, v_fleet_id, p_attempt,
    now() + make_interval(mins => v_minutos), v_notificados, v_outcome,
    CASE WHEN v_outcome = 'pendente' THEN NULL ELSE now() END
  )
  -- O indice unico parcial protege contra duas rondas abertas. Se ja' houver
  -- uma, esta chamada nao faz nada em vez de rebentar -- §72/§73, a operacao
  -- tem de ser idempotente perante retry.
  ON CONFLICT (delivery_id) WHERE outcome = 'pendente' DO NOTHING;

  RETURN v_notificados;
END;
$$;

COMMENT ON FUNCTION public.offer_delivery_to_fleet(uuid, integer) IS
  'Notifica os motoristas disponiveis da frota da entrega e regista a ronda em '
  'dispatch_attempts. Interna: nao verifica autorizacao, e o EXECUTE esta '
  'revogado a anon e a authenticated de proposito.';

REVOKE EXECUTE ON FUNCTION public.offer_delivery_to_fleet(uuid, integer) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- update_order_status: usa a funcao acima, e o cancelamento fecha a entrega
-- ---------------------------------------------------------------------------

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
        -- A notificacao em si mudou-se para offer_delivery_to_fleet, que alem de
        -- notificar REGISTA a tentativa em dispatch_attempts -- e' a mesma funcao
        -- que a expiracao volta a chamar na 2a ronda, para as duas rondas nao
        -- divergirem.
        v_notificados := public.offer_delivery_to_fleet(v_delivery_id, 1);

        IF v_fleet_id IS NULL THEN
          p_note := COALESCE(p_note, '') || ' [Entrega sem frota atribuida: bairro sem preco definido]';
        ELSIF v_notificados = 0 THEN
          p_note := COALESCE(p_note, '') || ' [Sem motorista disponivel na frota]';
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

  -- BUG CORRIGIDO AQUI: cancelar o PEDIDO nao cancelava a ENTREGA.
  -- A matriz de transicoes ja' deixava o restaurante cancelar a partir de
  -- `aguardando_motorista`, mas a linha de `deliveries` ficava `pendente` para
  -- sempre -- e `get_available_deliveries` continuava a oferece-la. Na pratica
  -- um motorista podia aceitar a entrega de um pedido ja' cancelado.
  --
  -- So' se cancela enquanto ninguem a levou. Se a entrega ja' vai a caminho, o
  -- cancelamento do pedido nao a apaga por baixo do motorista -- fica o registo
  -- e a operacao resolve-se no terreno (§56: nao reescrever historico).
  IF v_final_status = 'cancelado' THEN
    UPDATE public.deliveries
    SET status = 'cancelado', updated_at = now()
    WHERE order_id = p_order_id AND status = 'pendente';

    UPDATE public.dispatch_attempts
    SET outcome = 'cancelada', resolved_at = now(),
        note = 'Pedido cancelado por ' || COALESCE(auth.uid()::text, 'sistema')
    WHERE order_id = p_order_id AND outcome = 'pendente';
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

-- accept_delivery fecha a ronda aberta. Faz-se por trigger e nao por alteracao
-- da funcao porque ha' DOIS caminhos que atribuem motorista (accept_delivery e a
-- valvula do admin), e um trigger na tabela apanha os dois -- em vez de deixar
-- um deles a escrever historico errado em silencio.
CREATE OR REPLACE FUNCTION public.tg_dispatch_attempt_aceite()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.driver_id IS NOT NULL AND OLD.driver_id IS NULL THEN
    UPDATE public.dispatch_attempts
    SET outcome = 'aceite', resolved_at = now(), driver_id = NEW.driver_id
    WHERE delivery_id = NEW.id AND outcome = 'pendente';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dispatch_attempt_aceite ON public.deliveries;
CREATE TRIGGER dispatch_attempt_aceite
  AFTER UPDATE OF driver_id ON public.deliveries
  FOR EACH ROW EXECUTE FUNCTION public.tg_dispatch_attempt_aceite();
