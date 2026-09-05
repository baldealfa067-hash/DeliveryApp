-- pickup_delivery definia o pedido como 'pedido_recolhido' mas o estado
-- 'a_caminho' nunca era atribuído por nenhuma função — ficava em falta
-- no fluxo visível ao cliente. Esta correcção:
-- 1. Grava 'pedido_recolhido' no histórico (para a timeline ficar completa)
-- 2. Define o pedido como 'a_caminho' (estado visível ao cliente)
-- 3. Envia uma única notificação com a mensagem correcta

CREATE OR REPLACE FUNCTION public.pickup_delivery(p_delivery_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_customer_id uuid;
BEGIN
  UPDATE public.deliveries
  SET status = 'recolhido', picked_up_at = now(), updated_at = now()
  WHERE id = p_delivery_id
    AND driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
  RETURNING order_id INTO v_order_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Entrega não encontrada'; END IF;

  SELECT customer_id INTO v_customer_id FROM public.orders WHERE id = v_order_id;

  -- Definir 'a_caminho' no pedido (estado real para o cliente)
  UPDATE public.orders SET status = 'a_caminho', updated_at = now() WHERE id = v_order_id;

  -- Registar ambos os eventos na timeline do pedido
  INSERT INTO public.order_status_history (order_id, status, note)
  VALUES
    (v_order_id, 'pedido_recolhido', null),
    (v_order_id, 'a_caminho', null);

  IF v_customer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_customer_id, 'order_update', 'Pedido a caminho',
            '📍 O motorista recolheu o teu pedido e está a caminho.', '/meus-pedidos');
  END IF;
END;
$$;
