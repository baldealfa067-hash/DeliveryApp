-- FASE 2.2 -- correccao do alerta de pedido preso: o estado e' `pronto`, nao
-- `aguardando_motorista`.
--
-- A migracao anterior (20260916015412) procurava pedidos presos em
-- `aguardando_motorista` sem entrega. Essa combinacao NAO EXISTE, e o teste
-- provou-o em dois minutos: o pedido ficou em `pronto`.
--
-- O ramo em causa, lido da definicao viva do `update_order_status`:
--
--     IF <ha coordenadas dos dois lados> THEN
--        INSERT INTO deliveries ...
--        offer_delivery_to_fleet(...)
--        v_final_status := 'aguardando_motorista';   <-- so' aqui
--     ELSE
--        p_note := ... ' [Entrega automatica nao criada: coordenadas em falta]';
--     END IF;                                        <-- e fica em `pronto`
--
-- Ou seja: `aguardando_motorista` e' precisamente o estado que PROVA que a
-- entrega foi criada. Procurar ali um pedido sem entrega era procurar no unico
-- sitio onde ele nao podia estar. Corrigido para o estado real.
--
-- PARA UM PEDIDO DE ENTREGA, `pronto` NAO E' UM ESTADO DE REPOUSO: quando corre
-- bem, o mesmo `update_order_status` que escreve `pronto` ja' o converte em
-- `aguardando_motorista` antes de devolver, na mesma transaccao. Um pedido de
-- entrega parado em `pronto` esta', por definicao, preso.
--
-- Mesmo assim guarda-se uma folga de 2 minutos, medida na ultima linha do
-- historico do pedido: e' barata e protege de qualquer caminho futuro que
-- escreva `pronto` e so' depois trate da entrega num segundo passo.
--
-- Pedidos que NAO sao de entrega (`comer_no_local`, `para_levar`) ficam de fora
-- -- `pronto` e' o destino legitimo deles e nunca terao entrega nenhuma.

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
    WHERE o.consumption_option = 'entrega'
      -- `pronto` e' o estado real do pedido preso; `aguardando_motorista` fica
      -- na condicao por defesa, para o caso de algum caminho futuro la chegar
      -- sem criar entrega.
      AND o.status IN ('pronto', 'aguardando_motorista')
      AND NOT EXISTS (
        SELECT 1 FROM public.deliveries d WHERE d.order_id = o.id
      )
      -- Folga: so' depois de assentar. Evita apanhar um pedido a meio de um
      -- fluxo que escreva o estado e a entrega em dois passos.
      AND NOT EXISTS (
        SELECT 1 FROM public.order_status_history h
        WHERE h.order_id = o.id AND h.created_at > now() - interval '2 minutes'
      )
      -- IDEMPOTENCIA (§72/§73): uma vez por pedido, e nao de minuto a minuto
      -- para sempre. O proprio aviso e' a marca -- nao ha coluna nova a manter.
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
              ' esta pronto mas nao chegou a gerar uma entrega, por isso '
              || 'nenhuma frota o ve. Falta a localizacao do restaurante ou a '
              || 'do cliente. Verifique a morada do seu perfil.',
              '/painel-loja/editar', 'order', v_pedido.id);
    END IF;

    INSERT INTO public.notifications (
      user_id, type, title, body, link, reference_type, reference_id)
    SELECT ur.user_id, 'pedido_preso',
           'Pedido preso sem entrega',
           'Pedido #' || COALESCE(v_pedido.order_number::text, '?') ||
           ' de entrega sem linha em deliveries (coordenadas em falta).',
           '/admin', 'order', v_pedido.id
    FROM public.user_roles ur WHERE ur.role = 'admin';

    INSERT INTO public.order_status_history (order_id, status, note)
    VALUES (v_pedido.id, 'pronto',
            '[Preso: sem entrega associada (coordenadas em falta). Restaurante e admin notificados]');

    v_tratados := v_tratados + 1;
  END LOOP;

  RETURN v_tratados;
END;
$$;

COMMENT ON FUNCTION public.alert_stuck_orders() IS
  'Apanha os pedidos de ENTREGA parados em `pronto` que nunca chegaram a ter '
  'linha em deliveries (coordenadas em falta) -- invisiveis ao '
  'expire_stale_dispatch, que faz JOIN a essa tabela. Avisa restaurante e admin '
  'UMA vez por pedido (o proprio aviso e a marca de idempotencia). Nao resolve '
  'o pedido; tira-lhe o silencio.';

REVOKE EXECUTE ON FUNCTION public.alert_stuck_orders() FROM PUBLIC, anon, authenticated;
