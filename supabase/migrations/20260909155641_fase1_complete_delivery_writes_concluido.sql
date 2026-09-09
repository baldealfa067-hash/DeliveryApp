-- FASE 1 -- complete_delivery escrevia orders.status = 'entregue' directamente,
-- sem passar por update_order_status. Depois da fusao de `entregue` em
-- `concluido`, a proxima entrega concluida reintroduzia sozinha o estado morto
-- que a migracao anterior tinha acabado de eliminar.
--
-- validate_delivery_code chama complete_delivery, portanto fica corrigido pelos
-- dois caminhos com esta unica alteracao.
--
-- deliveries.status mantem-se 'entregue': e' outro dominio de valores, onde
-- `entregue` e' o unico terminal de sucesso e nao existe `concluido`.
CREATE OR REPLACE FUNCTION public.complete_delivery(p_delivery_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_customer_id uuid;
BEGIN
  UPDATE public.deliveries
  SET status = 'entregue', delivered_at = now(), updated_at = now()
  WHERE id = p_delivery_id
    AND driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
  RETURNING order_id INTO v_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entrega não encontrada';
  END IF;

  SELECT customer_id INTO v_customer_id FROM public.orders WHERE id = v_order_id;

  UPDATE public.orders SET status = 'concluido', updated_at = now() WHERE id = v_order_id;

  INSERT INTO public.order_status_history (order_id, status, created_by)
  VALUES (v_order_id, 'concluido', auth.uid());

  IF v_customer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_customer_id, 'order_update', 'Pedido entregue',
            '✅ Pedido entregue. Bom apetite!', '/meus-pedidos');
  END IF;
END;
$$;
