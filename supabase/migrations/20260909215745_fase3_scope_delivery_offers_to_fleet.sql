-- FASE 3 (Frotas) -- fechar a oferta e a aceitacao de entregas a' propria frota.
--
-- O dispatch por notificacao (fase3_dispatch_by_fleet) sozinho nao chega: o
-- motorista tambem chega a's entregas por consulta directa, e essas duas RPCs
-- estavam abertas a toda a plataforma.
--
--   get_available_deliveries()  devolvia TODAS as entregas pendentes, de
--                               qualquer frota, a qualquer motorista registado.
--   accept_delivery(uuid)       deixava QUALQUER motorista aceitar QUALQUER
--                               entrega pendente -- bastava o id.
--
-- Sem isto, §46 nao passava de uma intencao: a notificacao ia so' para a frota
-- certa, mas qualquer motorista da Frota B abria o painel e via -- e aceitava --
-- o trabalho da Frota A.
--
-- Motorista legado (fleet_id NULL) nao ve nem aceita nada: `NULL = NULL` nao e'
-- verdadeiro em SQL, portanto ficam naturalmente de fora. Fica explicito no
-- codigo para nao depender de um efeito lateral do SQL de tres valores.

CREATE OR REPLACE FUNCTION public.get_available_deliveries()
RETURNS TABLE(id uuid, order_id uuid, restaurant_name text, restaurant_address text,
              customer_address text, distance_km double precision, delivery_fee numeric,
              created_at timestamptz, restaurant_lat double precision,
              restaurant_lng double precision, voice_note_url text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_fleet_id uuid;
  v_disponivel boolean;
BEGIN
  SELECT dr.fleet_id, dr.is_available
  INTO v_fleet_id, v_disponivel
  FROM public.drivers dr WHERE dr.user_id = auth.uid();

  -- Nao e' motorista, esta' indisponivel, ou e' conta legado sem frota (§11):
  -- nao ha nada para mostrar.
  IF v_disponivel IS NOT TRUE OR v_fleet_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT d.id, d.order_id,
         p.name AS restaurant_name,
         d.restaurant_address,
         d.customer_address,
         d.distance_km,
         d.delivery_fee,
         d.created_at,
         d.restaurant_lat,
         d.restaurant_lng,
         o.voice_note_url
  FROM public.deliveries d
  JOIN public.orders   o ON o.id = d.order_id
  JOIN public.profiles p ON p.id = o.business_id
  WHERE d.status = 'pendente'
    AND d.driver_id IS NULL
    AND d.fleet_id = v_fleet_id
  ORDER BY d.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_delivery(p_delivery_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_driver_id uuid;
  v_driver_fleet uuid;
  v_delivery_fleet uuid;
  v_order_id uuid;
  v_customer_id uuid;
BEGIN
  SELECT id, fleet_id INTO v_driver_id, v_driver_fleet
  FROM public.drivers WHERE user_id = auth.uid();

  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'Nao e motorista registado';
  END IF;

  IF v_driver_fleet IS NULL THEN
    RAISE EXCEPTION 'Motorista sem frota associada nao pode aceitar entregas';
  END IF;

  SELECT fleet_id INTO v_delivery_fleet
  FROM public.deliveries WHERE id = p_delivery_id;

  -- §46: a entrega de uma frota nao e' aceitavel por motorista de outra.
  IF v_delivery_fleet IS DISTINCT FROM v_driver_fleet THEN
    RAISE EXCEPTION 'Entrega nao pertence a frota deste motorista';
  END IF;

  -- `driver_id IS NULL` no WHERE: §73, impede atribuicao dupla em toque
  -- repetido, retry ou push duplicado.
  UPDATE public.deliveries
  SET driver_id = v_driver_id, status = 'aceite', accepted_at = now(), updated_at = now()
  WHERE id = p_delivery_id AND status = 'pendente' AND driver_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entrega nao disponivel';
  END IF;

  SELECT d.order_id, o.customer_id INTO v_order_id, v_customer_id
  FROM public.deliveries d
  JOIN public.orders o ON o.id = d.order_id
  WHERE d.id = p_delivery_id;

  UPDATE public.orders SET status = 'motorista_encontrado', updated_at = now()
  WHERE id = v_order_id;

  INSERT INTO public.order_status_history (order_id, status, note)
  VALUES (v_order_id, 'motorista_encontrado', 'Motorista aceitou a entrega');

  IF v_customer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_customer_id, 'order_update', 'Motorista encontrado',
            'Um motorista aceitou a entrega.', '/meus-pedidos');
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_available_deliveries() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.accept_delivery(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_available_deliveries() TO authenticated;
GRANT  EXECUTE ON FUNCTION public.accept_delivery(uuid) TO authenticated;
