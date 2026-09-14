-- FASE 5 (Dispatch) -- expiracao da oferta e reencaminhamento manual (§34, §72).
--
-- O BURACO: uma entrega oferecida a' frota certa a que ninguem responde ficava
-- em `pendente` para sempre, com o pedido em `aguardando_motorista`. Ninguem era
-- avisado. O cliente ficava a olhar para "a espera de um motorista" sem fim.
--
-- DECISAO DO DONO DO PROJECTO (2026-09-14):
--   * 10 minutos por ronda, configuravel em `platform_settings`
--   * ao expirar, RE-OFERECE a' MESMA frota (2a ronda)
--   * se a 2a expirar, ESCALA: notifica o restaurante e os admins, e para
--   * NAO cai para outra frota automaticamente -- a frota e a taxa congelam no
--     checkout e o cliente aceitou AQUELE preco; trocar de frota mudava-lho por
--     baixo, contra §83. Se for preciso trocar, e' decisao humana
--   * o restaurante e o admin podem voltar a oferecer ou cancelar a' mao
--
-- PORQUE pg_cron E NAO UMA VERIFICACAO A' LEITURA: §71 poe a fonte de verdade no
-- backend e §72 diz que o pedido continua a existir com o frontend fechado. Uma
-- expiracao que so' corre quando alguem abre um ecra nao expira nada de noite,
-- que e' precisamente quando ninguem esta' a olhar. O trabalho tem de correr
-- sozinho.
--
-- A ENTREGA EXPIRADA CONTINUA `pendente` e continua a aparecer em
-- `get_available_deliveries`. Isto e' deliberado: um motorista que fique
-- disponivel tarde ainda a pode salvar, e tranca-la nao ajudava ninguem. O que
-- a expiracao muda e' que deixa de ser SILENCIO -- fica escrita em
-- `dispatch_attempts` e ha' pessoas notificadas.

-- ---------------------------------------------------------------------------
-- 1. O trabalho periodico
-- ---------------------------------------------------------------------------
--
-- IDEMPOTENTE (§72/§73): corre de minuto a minuto e pode correr duas vezes em
-- cima uma da outra sem duplicar rondas -- o indice unico parcial
-- `dispatch_attempts_uma_aberta_por_entrega` so' deixa existir uma ronda aberta
-- por entrega, e o UPDATE que fecha a ronda filtra por `outcome = 'pendente'`,
-- portanto a segunda passagem nao encontra nada para fechar.
--
-- auth.uid() e' NULL aqui: quem chama e' o agendador, nao uma pessoa. Por isso
-- esta funcao nao tem -- nem pode ter -- guarda por utilizador; o que a protege
-- e' o EXECUTE estar revogado a anon e a authenticated.

CREATE OR REPLACE FUNCTION public.expire_stale_dispatch()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tentativa      record;
  v_max_attempts   integer;
  v_tratadas       integer := 0;
  v_business_owner uuid;
  v_order_number   integer;
BEGIN
  SELECT COALESCE(NULLIF(value, '')::integer, 2) INTO v_max_attempts
  FROM public.platform_settings WHERE key = 'dispatch_max_attempts';
  v_max_attempts := COALESCE(v_max_attempts, 2);

  FOR v_tentativa IN
    SELECT da.id, da.delivery_id, da.order_id, da.fleet_id, da.attempt_number,
           d.status AS delivery_status, d.driver_id
    FROM public.dispatch_attempts da
    JOIN public.deliveries d ON d.id = da.delivery_id
    WHERE da.outcome = 'pendente'
      AND da.expires_at < now()
    -- Trava a linha da entrega para o job nao correr em cima de um
    -- accept_delivery a meio. SKIP LOCKED: o que estiver ocupado fica para a
    -- passagem seguinte, em vez de bloquear o job inteiro.
    FOR UPDATE OF d SKIP LOCKED
  LOOP
    -- Aceite ou cancelada entretanto: a ronda ja' nao esta' a espera de nada.
    -- Fecha-se com o desfecho verdadeiro em vez de a marcar expirada, que seria
    -- escrever historico falso.
    IF v_tentativa.driver_id IS NOT NULL THEN
      UPDATE public.dispatch_attempts
      SET outcome = 'aceite', resolved_at = now(), driver_id = v_tentativa.driver_id
      WHERE id = v_tentativa.id AND outcome = 'pendente';
      CONTINUE;
    END IF;

    IF v_tentativa.delivery_status <> 'pendente' THEN
      UPDATE public.dispatch_attempts
      SET outcome = 'cancelada', resolved_at = now(),
          note = 'Entrega passou a ' || v_tentativa.delivery_status || ' antes de expirar'
      WHERE id = v_tentativa.id AND outcome = 'pendente';
      CONTINUE;
    END IF;

    UPDATE public.dispatch_attempts
    SET outcome = 'expirada', resolved_at = now(),
        note = 'Sem resposta em ' || v_tentativa.attempt_number || 'a ronda'
    WHERE id = v_tentativa.id AND outcome = 'pendente';

    v_tratadas := v_tratadas + 1;

    IF v_tentativa.attempt_number < v_max_attempts THEN
      -- 2a ronda, mesma frota, mesmo preco.
      PERFORM public.offer_delivery_to_fleet(
        v_tentativa.delivery_id, v_tentativa.attempt_number + 1
      );
    ELSE
      -- Esgotou. Escala para quem pode decidir: o dono do restaurante e os
      -- admins. O texto diz o que aconteceu e nao promete recuperacao
      -- automatica, porque nao ha' nenhuma a partir daqui (§83).
      SELECT p.user_id, o.order_number INTO v_business_owner, v_order_number
      FROM public.orders o
      JOIN public.profiles p ON p.id = o.business_id
      WHERE o.id = v_tentativa.order_id;

      IF v_business_owner IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, type, title, body, link)
        VALUES (v_business_owner, 'dispatch_expirado',
                'Pedido sem motorista',
                'O pedido #' || COALESCE(v_order_number::text, '?') ||
                ' continua sem motorista depois de ' || v_max_attempts ||
                ' tentativas. Pode voltar a oferecer ou cancelar.',
                '/painel-loja');
      END IF;

      INSERT INTO public.notifications (user_id, type, title, body, link)
      SELECT ur.user_id, 'dispatch_expirado',
             'Entrega sem motorista',
             'Pedido #' || COALESCE(v_order_number::text, '?') ||
             ' sem motorista apos ' || v_max_attempts || ' tentativas.',
             '/admin'
      FROM public.user_roles ur WHERE ur.role = 'admin';

      INSERT INTO public.order_status_history (order_id, status, note)
      VALUES (v_tentativa.order_id, 'aguardando_motorista',
              '[Dispatch esgotado: ' || v_max_attempts ||
              ' rondas sem motorista. Restaurante e admin notificados]');
    END IF;
  END LOOP;

  RETURN v_tratadas;
END;
$$;

COMMENT ON FUNCTION public.expire_stale_dispatch() IS
  'Trabalho periodico (pg_cron, ao minuto): fecha rondas de dispatch vencidas, '
  're-oferece a mesma frota ate dispatch_max_attempts, e depois escala para o '
  'restaurante e os admins. Idempotente. Sem guarda por utilizador de proposito '
  '-- corre pelo agendador; o EXECUTE esta revogado a anon e authenticated.';

REVOKE EXECUTE ON FUNCTION public.expire_stale_dispatch() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Reencaminhamento manual -- restaurante e admin
-- ---------------------------------------------------------------------------
--
-- O cancelamento manual ja' existe e nao se mexe: a matriz de transicoes de
-- `update_order_status` deixa cancelar a partir de `aguardando_motorista`, e a
-- migracao anterior fez esse cancelamento fechar tambem a entrega e a ronda
-- aberta. O que faltava era o OUTRO lado -- voltar a oferecer sem cancelar.
--
-- A autorizacao e' a mesma de update_order_status para o dono: `profiles.user_id
-- = auth.uid()` no negocio do pedido. A frota NAO entra: para ela isto seria
-- mais uma superficie de escrita sobre `deliveries`, e a decisao de 2026-09-10 e'
-- que a frota chega aos seus dados por RPC de leitura. Se vier a ser preciso,
-- acrescenta-se uma RPC propria, falando com o dono do projecto primeiro.

CREATE OR REPLACE FUNCTION public.reoffer_delivery(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_delivery_id uuid;
  v_status      text;
  v_driver_id   uuid;
  v_fleet_id    uuid;
  v_proxima     integer;
  v_notificados integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sem sessao';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.orders o
      JOIN public.profiles p ON p.id = o.business_id
      WHERE o.id = p_order_id AND p.user_id = auth.uid()
    )
  ) THEN
    RAISE EXCEPTION 'Sem autorizacao para reencaminhar este pedido';
  END IF;

  SELECT d.id, d.status, d.driver_id, d.fleet_id
  INTO v_delivery_id, v_status, v_driver_id, v_fleet_id
  FROM public.deliveries d WHERE d.order_id = p_order_id;

  IF v_delivery_id IS NULL THEN
    RAISE EXCEPTION 'Este pedido nao tem entrega associada';
  END IF;

  -- Nao se re-oferece o que ja' tem dono: seria oferecer a dois motoristas o
  -- mesmo trabalho (§73, atribuicao duplicada).
  IF v_driver_id IS NOT NULL THEN
    RAISE EXCEPTION 'A entrega ja foi aceite por um motorista';
  END IF;

  IF v_status <> 'pendente' THEN
    RAISE EXCEPTION 'A entrega esta em % e nao pode ser reoferecida', v_status;
  END IF;

  IF v_fleet_id IS NULL THEN
    RAISE EXCEPTION 'Entrega sem frota atribuida: o bairro nao tem preco definido';
  END IF;

  -- Fecha a ronda aberta, se houver, para o indice unico parcial deixar abrir a
  -- seguinte.
  UPDATE public.dispatch_attempts
  SET outcome = 'expirada', resolved_at = now(),
      note = 'Reoferecida a mao por ' || auth.uid()::text
  WHERE delivery_id = v_delivery_id AND outcome = 'pendente';

  SELECT COALESCE(max(attempt_number), 0) + 1 INTO v_proxima
  FROM public.dispatch_attempts WHERE delivery_id = v_delivery_id;

  v_notificados := public.offer_delivery_to_fleet(v_delivery_id, v_proxima);

  INSERT INTO public.order_status_history (order_id, status, note, created_by)
  VALUES (p_order_id, 'aguardando_motorista',
          '[Reoferecida a mao: ' || v_notificados || ' motorista(s) notificado(s)]',
          auth.uid());

  RETURN jsonb_build_object(
    'ronda', v_proxima,
    'motoristas_notificados', v_notificados
  );
END;
$$;

COMMENT ON FUNCTION public.reoffer_delivery(uuid) IS
  'Volta a oferecer aos motoristas da mesma frota uma entrega ainda sem dono. '
  'Dono do restaurante do pedido, ou admin. Nao troca de frota: o preco '
  'congelou no checkout (§83).';

REVOKE EXECUTE ON FUNCTION public.reoffer_delivery(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reoffer_delivery(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Agendamento
-- ---------------------------------------------------------------------------
-- Ao minuto. O intervalo do job nao e' o tempo de espera -- esse esta' em
-- `platform_settings.dispatch_timeout_minutes` e e' o que decide quando uma
-- ronda vence. O job so' verifica; correr de minuto a minuto so' significa que
-- a expiracao e' notada com um minuto de atraso, no maximo.

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('expirar-dispatch')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expirar-dispatch');

SELECT cron.schedule(
  'expirar-dispatch',
  '* * * * *',
  $cron$SELECT public.expire_stale_dispatch();$cron$
);
