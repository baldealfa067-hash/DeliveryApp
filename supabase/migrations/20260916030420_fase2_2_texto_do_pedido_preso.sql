-- O texto do alerta de pedido preso deixou de ser verdade.
--
-- `alert_stuck_orders` nasceu para a unica causa conhecida na altura -- faltar
-- GPS -- e dizia-o ao restaurante: "Falta a localizacao do restaurante ou a do
-- cliente. Verifique a morada do seu perfil."
--
-- Com a decisao de hoje essa causa DESAPARECEU: a entrega passa a ser criada com
-- ou sem coordenadas. Um pedido que agora chegue aqui chegou por outro motivo
-- qualquer, e mandar o dono verificar a morada do perfil e' manda-lo arranjar o
-- que nao esta' avariado.
--
-- §84 pede que o sistema consiga explicar o que afirma. Como aqui a causa
-- deixou de ser conhecida a' partida, o honesto e' dizer o que se observou -- o
-- pedido esta pronto e nao gerou entrega -- e nao inventar um porque. E' a mesma
-- disciplina do `distance_km` a NULL: nao preencher com um valor plausivel o
-- que nao se mediu.
--
-- Mantem-se a funcao como rede de seguranca, agora generica.

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
      AND o.status IN ('pronto', 'aguardando_motorista')
      AND NOT EXISTS (
        SELECT 1 FROM public.deliveries d WHERE d.order_id = o.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.order_status_history h
        WHERE h.order_id = o.id AND h.created_at > now() - interval '2 minutes'
      )
      -- IDEMPOTENCIA (§72/§73): uma vez por pedido. O proprio aviso e' a marca.
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
              ' esta pronto mas nao gerou uma entrega, por isso nenhuma frota o '
              || 've. Contacte o suporte -- este pedido precisa de ser '
              || 'destravado a mao.',
              '/painel-loja', 'order', v_pedido.id);
    END IF;

    INSERT INTO public.notifications (
      user_id, type, title, body, link, reference_type, reference_id)
    SELECT ur.user_id, 'pedido_preso',
           'Pedido preso sem entrega',
           'Pedido #' || COALESCE(v_pedido.order_number::text, '?') ||
           ' de entrega em ' || (SELECT status FROM public.orders WHERE id = v_pedido.id) ||
           ' sem linha em deliveries. Causa desconhecida -- investigar.',
           '/admin', 'order', v_pedido.id
    FROM public.user_roles ur WHERE ur.role = 'admin';

    INSERT INTO public.order_status_history (order_id, status, note)
    VALUES (v_pedido.id, 'pronto',
            '[Preso: sem entrega associada. Restaurante e admin notificados]');

    v_tratados := v_tratados + 1;
  END LOOP;

  RETURN v_tratados;
END;
$$;

COMMENT ON FUNCTION public.alert_stuck_orders() IS
  'Rede de seguranca: pedidos de ENTREGA parados sem linha em deliveries, '
  'invisiveis ao expire_stale_dispatch (que faz JOIN a essa tabela). Desde '
  '2026-09-16 a falta de GPS deixou de ser causa -- a entrega e criada na mesma '
  '-- portanto o que chegar aqui tem causa desconhecida e o texto nao a inventa. '
  'Avisa restaurante e admin UMA vez por pedido.';

REVOKE EXECUTE ON FUNCTION public.alert_stuck_orders() FROM PUBLIC, anon, authenticated;
