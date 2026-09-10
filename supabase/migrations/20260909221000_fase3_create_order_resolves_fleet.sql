-- FASE 3 (Frotas) -- o pedido passa a nascer ja' com frota e taxa resolvidas.
--
-- POR QUE E' INDISPENSAVEL: fase3_dispatch_by_fleet passou a despachar a partir
-- de `orders.fleet_id`. Sem esta migracao NADA escreve essa coluna, portanto
-- todos os pedidos novos ficariam com fleet_id NULL e nenhuma entrega seria
-- oferecida a ninguem. As duas migracoes formam um par -- aplicar so' a primeira
-- deixa o dispatch parado.
--
-- §14/§83: o preco resolve-se aqui, no momento em que o pedido e' criado, e fica
-- congelado. O cliente ve'-o antes de confirmar e e' esse que se cobra, mesmo que
-- a frota mude a grelha a seguir.
--
-- `total` NAO passa a incluir a entrega. §27 separa as duas coisas de proposito:
-- comida 10.000 + entrega 1.000 = 11.000 pagos pelo cliente, mas 10.000
-- pertencem ao restaurante e 1.000 a' frota, e a Fase 6 vai precisar deles
-- separados para o ledger. O frontend soma para mostrar o total.
--
-- Bairro sem preco definido por nenhuma frota: o pedido e' criado na mesma, com
-- fleet_id e delivery_fee a NULL. Nao se bloqueia a venda do restaurante por
-- causa da logistica; fica visivel que nao ha entrega possivel para ali, e
-- update_order_status regista a nota quando chegar a "pronto".

CREATE OR REPLACE FUNCTION public.create_order(
  p_business_id uuid, p_customer_id uuid, p_customer_name text, p_customer_phone text,
  p_items jsonb, p_total numeric, p_consumption_option text,
  p_address text DEFAULT NULL, p_notes text DEFAULT NULL, p_bairro text DEFAULT NULL,
  p_customer_lat double precision DEFAULT NULL, p_customer_lng double precision DEFAULT NULL,
  p_voice_note_url text DEFAULT NULL, p_payment_method text DEFAULT 'entrega',
  p_payment_proof_url text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_order_id uuid;
  v_order_number integer;
  v_delivery_code text;
  v_owner_id uuid;
  v_fleet_id uuid;
  v_delivery_fee numeric;
BEGIN
  PERFORM public.assert_can_order_for(p_business_id, p_customer_id);

  IF p_customer_name IS NULL OR btrim(p_customer_name) = '' THEN
    RAISE EXCEPTION 'Nome do cliente obrigatorio';
  END IF;
  IF p_customer_phone IS NULL OR btrim(p_customer_phone) = '' THEN
    RAISE EXCEPTION 'Telefone do cliente obrigatorio';
  END IF;
  IF p_total < 0 THEN
    RAISE EXCEPTION 'Total invalido';
  END IF;
  IF p_consumption_option NOT IN ('comer_no_local', 'para_levar', 'entrega') THEN
    RAISE EXCEPTION 'Opcao de consumo invalida';
  END IF;
  IF p_payment_method NOT IN ('entrega', 'online') THEN
    RAISE EXCEPTION 'Metodo de pagamento invalido';
  END IF;

  -- §13/§14: frota e preco vem do bairro, nunca da distancia (§15).
  IF p_consumption_option = 'entrega' AND p_bairro IS NOT NULL THEN
    SELECT gp.fleet_id, gp.preco INTO v_fleet_id, v_delivery_fee
    FROM public.get_delivery_price(p_bairro) gp;
  END IF;

  v_delivery_code := lpad((floor(random() * 1000000))::text, 6, '0');

  SELECT COALESCE(MAX(order_number), 0) + 1 INTO v_order_number
  FROM public.orders WHERE business_id = p_business_id;

  INSERT INTO public.orders (
    business_id, customer_id, customer_name, customer_phone,
    items, total, status, consumption_option,
    address, notes, order_number, delivery_code,
    bairro, customer_lat, customer_lng, voice_note_url,
    payment_method, payment_proof_url, payment_status,
    fleet_id, delivery_fee
  ) VALUES (
    p_business_id,
    p_customer_id,
    btrim(p_customer_name),
    btrim(p_customer_phone),
    p_items,
    p_total,
    'novo',
    p_consumption_option,
    CASE WHEN p_consumption_option = 'entrega' THEN p_address ELSE NULL END,
    p_notes,
    v_order_number,
    v_delivery_code,
    CASE WHEN p_consumption_option = 'entrega' THEN p_bairro ELSE NULL END,
    CASE WHEN p_consumption_option = 'entrega' THEN p_customer_lat ELSE NULL END,
    CASE WHEN p_consumption_option = 'entrega' THEN p_customer_lng ELSE NULL END,
    CASE WHEN p_consumption_option = 'entrega' THEN p_voice_note_url ELSE NULL END,
    p_payment_method,
    p_payment_proof_url,
    'pendente',
    v_fleet_id,
    v_delivery_fee
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_status_history (order_id, status, created_by)
  VALUES (v_order_id, 'novo', p_customer_id);

  BEGIN
    INSERT INTO public.provider_activity (provider_id, activity_type)
    VALUES (p_business_id, 'order');
  EXCEPTION WHEN others THEN NULL;
  END;

  SELECT user_id INTO v_owner_id FROM public.profiles WHERE id = p_business_id;
  IF v_owner_id IS NOT NULL AND v_owner_id IS DISTINCT FROM p_customer_id THEN
    PERFORM public.create_notification(
      v_owner_id,
      'Novo Pedido #' || v_order_number,
      btrim(p_customer_name) || ' fez um pedido de ' || p_total || ' FCFA',
      'order', 'order', v_order_id
    );
  END IF;

  RETURN v_order_id;
END;
$function$;
