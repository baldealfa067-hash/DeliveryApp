-- FASE 2.2 -- o pedido preso que NENHUM alerta apanhava.
--
-- ENCONTRADO A TESTAR, nao a ler codigo. O teste de ponta a ponta
-- (`scripts/alertas-dispatch-test.mjs`) pos um pedido em `aguardando_motorista`
-- e depois nao encontrou ronda de dispatch nenhuma para expirar. A causa:
--
--   `update_order_status` so' cria a linha de `deliveries` quando tem
--   coordenadas do restaurante E do cliente -- precisa das duas para a
--   distancia (§40). Se faltar uma, NAO cria entrega...
--   ...mas poe o pedido em `aguardando_motorista` na mesma.
--
-- O resultado e' um pedido que diz ao cliente "a procurar motorista" e que NAO
-- tem entrega nenhuma a ser procurada. E `expire_stale_dispatch` nunca lhe
-- toca, porque faz JOIN a `deliveries` -- sem entrega nao ha ronda, sem ronda
-- nao ha expiracao, sem expiracao nao ha aviso. Fica preso para sempre, em
-- silencio, e e' o PIOR dos casos presos: os outros pelo menos expiram.
--
-- Acontece quando o restaurante nao tem lat/lng no perfil, que e' um campo que
-- ninguem e' obrigado a preencher. Nao e' hipotetico.
--
-- PORQUE NAO SE CORRIGE NO `update_order_status`: mexer-lhe outra vez nesta
-- mesma fase e' o risco que ja' se materializou uma vez hoje (ver
-- `20260916014049`). E a decisao de fundo -- se um pedido de entrega sem GPS
-- deve ser recusado no checkout, ou aceite e despachado sem distancia -- e' de
-- produto, nao de engenharia, e §21 diz que o mapa NAO e' a interface
-- principal, o que sugere que a entrega devia poder existir sem coordenadas.
-- Isso e' conversa para ter com o dono do projecto.
--
-- O que esta migracao faz e' estritamente o que a Fase 2.2 pede: tirar o
-- SILENCIO. O pedido continua preso, mas agora alguem sabe.

CREATE OR REPLACE FUNCTION public.alert_stuck_orders()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_pedido   record;
  v_tratados integer := 0;
BEGIN
  FOR v_pedido IN
    SELECT o.id, o.order_number, p.user_id AS dono
    FROM public.orders o
    JOIN public.profiles p ON p.id = o.business_id
    WHERE o.status = 'aguardando_motorista'
      -- Sem entrega nenhuma. Nao ha aqui condicao de corrida a acautelar: o
      -- estado e a entrega sao escritos na MESMA transaccao do
      -- update_order_status, portanto o agendador nunca ve um sem o outro a
      -- menos que a entrega mesmo nao tenha sido criada.
      AND NOT EXISTS (
        SELECT 1 FROM public.deliveries d WHERE d.order_id = o.id
      )
      -- IDEMPOTENCIA (§72/§73): uma vez por pedido, nao de minuto a minuto para
      -- sempre. O proprio aviso e' a marca -- nao ha coluna nova a manter.
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.reference_id = o.id AND n.type = 'pedido_preso'
      )
  LOOP
    IF v_pedido.dono IS NOT NULL THEN
      INSERT INTO public.notifications (
        user_id, type, title, body, link, reference_type, reference_id)
      VALUES (v_pedido.dono, 'pedido_preso',
              'Pedido parado sem entrega',
              'O pedido #' || COALESCE(v_pedido.order_number::text, '?') ||
              ' esta a espera de motorista mas nao chegou a gerar uma entrega, '
              || 'por isso nenhuma frota o ve. Falta a localizacao do '
              || 'restaurante ou a do cliente. Verifique a morada do seu perfil.',
              '/painel-loja/editar', 'order', v_pedido.id);
    END IF;

    INSERT INTO public.notifications (
      user_id, type, title, body, link, reference_type, reference_id)
    SELECT ur.user_id, 'pedido_preso',
           'Pedido preso sem entrega',
           'Pedido #' || COALESCE(v_pedido.order_number::text, '?') ||
           ' em aguardando_motorista sem linha em deliveries (falta GPS).',
           '/admin', 'order', v_pedido.id
    FROM public.user_roles ur WHERE ur.role = 'admin';

    INSERT INTO public.order_status_history (order_id, status, note)
    VALUES (v_pedido.id, 'aguardando_motorista',
            '[Preso: sem entrega associada (falta lat/lng). Restaurante e admin notificados]');

    v_tratados := v_tratados + 1;
  END LOOP;

  RETURN v_tratados;
END;
$$;

COMMENT ON FUNCTION public.alert_stuck_orders() IS
  'Apanha os pedidos em aguardando_motorista que nunca chegaram a ter linha em '
  'deliveries -- invisiveis ao expire_stale_dispatch, que faz JOIN a essa '
  'tabela. Avisa restaurante e admin UMA vez por pedido (o proprio aviso e a '
  'marca de idempotencia). Nao resolve o pedido; tira-lhe o silencio.';

REVOKE EXECUTE ON FUNCTION public.alert_stuck_orders() FROM PUBLIC, anon, authenticated;

-- Ao minuto, como o outro. Job separado de proposito: se este rebentar, a
-- expiracao normal do dispatch continua a correr.
SELECT cron.unschedule('alertar-pedidos-presos')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'alertar-pedidos-presos');

SELECT cron.schedule(
  'alertar-pedidos-presos',
  '* * * * *',
  $cron$SELECT public.alert_stuck_orders();$cron$
);
