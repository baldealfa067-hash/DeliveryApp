-- O motorista passa a ver o que transporta e como o pedido e' pago.
--
-- O QUE FALTAVA, e nunca esteve la' -- nenhuma versao destas duas funcoes, em
-- nenhuma migracao, devolveu `items`. Nao e' regressao, e' lacuna desde o
-- inicio:
--   items          -- o que foi encomendado. §51: o motorista esta' na rua e
--                     precisa de saber o que leva, nem que seja para conferir
--                     com o restaurante antes de sair.
--   order_total    -- o valor da COMIDA. §28: no pagamento em dinheiro e' o
--                     motorista que recebe comida+entrega do cliente e deve a
--                     comida ao restaurante. Sem este numero ele nao sabe
--                     quanto pedir nem quanto entregar.
--   payment_method / payment_status -- como e' pago.
--
-- `delivery_fee` ja' era devolvida pelas duas desde a Fase 3: o motorista nao a
-- via por falta de ecra, nao por falta de dado.
--
-- SOBRE O ESTADO DE PAGAMENTO (decisao do dono do projecto, 2026-09-10):
-- nao se mostra "Pago" automatico. Em dinheiro na entrega o sistema so' sabe
-- que a entrega foi concluida -- nao sabe se o dinheiro mudou de maos. Dizer
-- "Pago" seria afirmar o que nao se sabe (§84). Devolve-se o metodo e o estado
-- em bruto; a interface mostra "Dinheiro na entrega" ou, quando ha' comprovativo
-- validado, "Orange Money - pago". A reconciliacao real e' o ledger da Fase 6.
--
-- DROP + CREATE por causa do RETURNS TABLE, o que apaga o ACL -- reposto no fim.

DROP FUNCTION IF EXISTS public.get_my_deliveries();
CREATE FUNCTION public.get_my_deliveries()
RETURNS TABLE(id uuid, order_id uuid, order_number integer, restaurant_name text,
              restaurant_phone text, restaurant_address text, customer_name text,
              customer_phone text, customer_address text, distance_km double precision,
              delivery_fee numeric, order_total numeric, items jsonb,
              payment_method text, payment_status text,
              status text, accepted_at timestamptz, picked_up_at timestamptz,
              delivered_at timestamptz, created_at timestamptz,
              restaurant_lat double precision, restaurant_lng double precision,
              customer_lat double precision, customer_lng double precision,
              voice_note_url text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_driver_id uuid;
BEGIN
  SELECT drivers.id INTO v_driver_id FROM public.drivers WHERE user_id = auth.uid();
  IF v_driver_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT d.id, d.order_id, o.order_number,
         rp.name AS restaurant_name, rp.phone AS restaurant_phone,
         d.restaurant_address,
         o.customer_name, o.customer_phone,
         d.customer_address, d.distance_km, d.delivery_fee,
         o.total AS order_total, o.items,
         COALESCE(o.payment_method, 'entrega') AS payment_method,
         COALESCE(o.payment_status, 'pendente') AS payment_status,
         d.status, d.accepted_at, d.picked_up_at, d.delivered_at, d.created_at,
         d.restaurant_lat, d.restaurant_lng,
         d.customer_lat, d.customer_lng,
         o.voice_note_url
  FROM public.deliveries d
  JOIN public.orders o ON o.id = d.order_id
  JOIN public.profiles rp ON rp.id = o.business_id
  WHERE d.driver_id = v_driver_id
  ORDER BY d.created_at DESC;
END;
$function$;

DROP FUNCTION IF EXISTS public.get_available_deliveries();
CREATE FUNCTION public.get_available_deliveries()
RETURNS TABLE(id uuid, order_id uuid, restaurant_name text, restaurant_address text,
              customer_address text, distance_km double precision, delivery_fee numeric,
              order_total numeric, items jsonb, payment_method text, payment_status text,
              created_at timestamptz, restaurant_lat double precision,
              restaurant_lng double precision, voice_note_url text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_fleet_id uuid;
  v_disponivel boolean;
BEGIN
  SELECT dr.fleet_id, dr.is_available
  INTO v_fleet_id, v_disponivel
  FROM public.drivers dr WHERE dr.user_id = auth.uid();

  -- Nao e' motorista, esta' indisponivel, ou e' conta legado sem frota (§11).
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
         o.total AS order_total, o.items,
         COALESCE(o.payment_method, 'entrega') AS payment_method,
         COALESCE(o.payment_status, 'pendente') AS payment_status,
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
$function$;

-- ACL reposto. Regra de 20260910033308: revogar de PUBLIC E de anon.
REVOKE EXECUTE ON FUNCTION public.get_my_deliveries()        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_available_deliveries() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_my_deliveries()        TO authenticated;
GRANT  EXECUTE ON FUNCTION public.get_available_deliveries() TO authenticated;
