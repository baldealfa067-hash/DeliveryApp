-- Corrige a exposicao de RPCs SECURITY DEFINER ao papel `anon`.
--
-- Problema: 14 funcoes SECURITY DEFINER podiam ser chamadas por qualquer pessoa
-- com a chave anon (que esta publica no bundle do frontend). Como SECURITY DEFINER
-- ignora o RLS, era possivel ler pedidos, telefones, moradas, codigos de entrega e
-- comprovativos de pagamento de qualquer cliente ou restaurante, seguir qualquer
-- entrega, criar notificacoes (e push) para qualquer utilizador e criar pedidos em
-- nome de terceiros.
--
-- Correcao em duas camadas:
--   1. Verificacao de dono dentro de cada funcao (auth.uid()).
--   2. REVOKE do papel anon e do PUBLIC (defesa em profundidade).

-- ---------------------------------------------------------------------------
-- Helper: o utilizador autenticado e dono deste estabelecimento?
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_business_owner(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.profiles
       WHERE id = p_business_id AND user_id = auth.uid()
     );
$function$;

REVOKE EXECUTE ON FUNCTION public.is_business_owner(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_business_owner(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_business_owner(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Leitura de pedidos do estabelecimento: so o dono ou um admin
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_business_orders(p_business_id uuid, p_status text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, business_id uuid, business_name text, customer_id uuid, customer_name text, customer_phone text, items jsonb, total numeric, status text, consumption_option text, address text, notes text, order_number integer, preparation_time integer, delivery_code text, bairro text, voice_note_url text, payment_method text, payment_proof_url text, payment_status text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nao autenticado';
  END IF;
  IF NOT public.is_business_owner(p_business_id) AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT
    o.id, o.business_id,
    COALESCE(p.name, '') AS business_name,
    o.customer_id, o.customer_name, o.customer_phone,
    o.items, o.total, o.status, o.consumption_option,
    o.address, o.notes, o.order_number, o.preparation_time,
    o.delivery_code, o.bairro, o.voice_note_url,
    COALESCE(o.payment_method, 'entrega') AS payment_method,
    o.payment_proof_url,
    COALESCE(o.payment_status, 'pendente') AS payment_status,
    o.created_at
  FROM public.orders o
  LEFT JOIN public.profiles p ON p.id = o.business_id
  WHERE o.business_id = p_business_id
    AND (p_status IS NULL OR o.status = p_status)
  ORDER BY o.created_at DESC;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Leitura de pedidos do cliente: so o proprio ou um admin
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_customer_orders(p_customer_id uuid)
 RETURNS TABLE(id uuid, business_id uuid, business_name text, customer_id uuid, customer_name text, customer_phone text, items jsonb, total numeric, status text, consumption_option text, address text, notes text, order_number integer, preparation_time integer, delivery_code text, bairro text, voice_note_url text, payment_method text, payment_proof_url text, payment_status text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nao autenticado';
  END IF;
  IF p_customer_id IS DISTINCT FROM auth.uid() AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT
    o.id, o.business_id,
    COALESCE(p.name, '') AS business_name,
    o.customer_id, o.customer_name, o.customer_phone,
    o.items, o.total, o.status, o.consumption_option,
    o.address, o.notes, o.order_number, o.preparation_time,
    o.delivery_code, o.bairro, o.voice_note_url,
    COALESCE(o.payment_method, 'entrega') AS payment_method,
    o.payment_proof_url,
    COALESCE(o.payment_status, 'pendente') AS payment_status,
    o.created_at
  FROM public.orders o
  LEFT JOIN public.profiles p ON p.id = o.business_id
  WHERE o.customer_id = p_customer_id
  ORDER BY o.created_at DESC;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Historico de um pedido: cliente, dono da loja, motorista atribuido ou admin
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_order_history(p_order_id uuid)
 RETURNS TABLE(status text, note text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nao autenticado';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.orders o
    LEFT JOIN public.profiles p ON p.id = o.business_id
    WHERE o.id = p_order_id
      AND (
        o.customer_id = auth.uid()
        OR p.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.deliveries d
          JOIN public.drivers dr ON dr.id = d.driver_id
          WHERE d.order_id = o.id AND dr.user_id = auth.uid()
        )
      )
  ) AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT h.status, h.note, h.created_at
  FROM public.order_status_history h
  WHERE h.order_id = p_order_id
  ORDER BY h.created_at ASC;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Rastreio da entrega: motorista, cliente, dono da loja ou admin
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_delivery_tracking(p_delivery_id uuid)
 RETURNS TABLE(lat double precision, lng double precision, status text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nao autenticado';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.deliveries d
    LEFT JOIN public.orders o ON o.id = d.order_id
    LEFT JOIN public.profiles p ON p.id = o.business_id
    LEFT JOIN public.drivers dr ON dr.id = d.driver_id
    WHERE d.id = p_delivery_id
      AND (
        dr.user_id = auth.uid()
        OR o.customer_id = auth.uid()
        OR p.user_id = auth.uid()
      )
  ) AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT dt.lat, dt.lng, dt.status, dt.created_at
  FROM public.delivery_tracking dt
  WHERE dt.delivery_id = p_delivery_id
  ORDER BY dt.created_at ASC;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Pedidos prontos para entrega de um estabelecimento: so o dono ou admin
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_delivery_orders(p_business_id uuid)
 RETURNS TABLE(order_id uuid, order_number integer, customer_name text, customer_address text, total numeric, status text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nao autenticado';
  END IF;
  IF NOT public.is_business_owner(p_business_id) AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT o.id, o.order_number, o.customer_name, o.address,
         o.total, o.status, o.created_at
  FROM public.orders o
  WHERE o.business_id = p_business_id
    AND o.consumption_option = 'entrega'
    AND o.status IN ('pronto', 'aguardando_motorista')
  ORDER BY o.created_at DESC;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Agendamentos do estabelecimento: so o dono ou admin
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_business_appointments(p_business_id uuid, p_status text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, customer_name text, customer_phone text, service_name text, service_price numeric, appointment_date date, appointment_time time without time zone, status text, notes text, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nao autenticado';
  END IF;
  IF NOT public.is_business_owner(p_business_id) AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT a.id, a.customer_name, a.customer_phone,
         a.service_name, a.service_price,
         a.appointment_date, a.appointment_time,
         a.status, a.notes, a.created_at, a.updated_at
  FROM public.appointments a
  WHERE a.business_id = p_business_id
    AND (p_status IS NULL OR a.status = p_status)
  ORDER BY a.appointment_date DESC, a.appointment_time DESC;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Agendamentos do cliente: so o proprio ou admin
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_customer_appointments(p_customer_id uuid)
 RETURNS TABLE(id uuid, business_id uuid, business_name text, service_name text, service_price numeric, appointment_date date, appointment_time time without time zone, status text, notes text, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nao autenticado';
  END IF;
  IF p_customer_id IS DISTINCT FROM auth.uid() AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT a.id, a.business_id, p.name as business_name,
         a.service_name, a.service_price,
         a.appointment_date, a.appointment_time,
         a.status, a.notes, a.created_at, a.updated_at
  FROM public.appointments a
  JOIN public.profiles p ON p.id = a.business_id
  WHERE a.customer_id = p_customer_id
  ORDER BY a.appointment_date DESC, a.appointment_time DESC;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Helper: pode criar um pedido em nome deste customer_id?
-- O proprio cliente, o dono do estabelecimento (balcao) ou um admin.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_can_order_for(p_business_id uuid, p_customer_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Precisa de iniciar sessao para fazer um pedido';
  END IF;
  IF p_customer_id IS DISTINCT FROM auth.uid()
     AND NOT public.is_business_owner(p_business_id)
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Nao pode criar pedidos em nome de outro utilizador';
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.assert_can_order_for(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assert_can_order_for(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.assert_can_order_for(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- create_order (versao atual, 15 argumentos) — unica exposta ao anon
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_order(p_business_id uuid, p_customer_id uuid, p_customer_name text, p_customer_phone text, p_items jsonb, p_total numeric, p_consumption_option text, p_address text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_bairro text DEFAULT NULL::text, p_customer_lat double precision DEFAULT NULL::double precision, p_customer_lng double precision DEFAULT NULL::double precision, p_voice_note_url text DEFAULT NULL::text, p_payment_method text DEFAULT 'entrega'::text, p_payment_proof_url text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id uuid;
  v_order_number integer;
  v_delivery_code text;
  v_owner_id uuid;
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

  v_delivery_code := lpad((floor(random() * 1000000))::text, 6, '0');

  SELECT COALESCE(MAX(order_number), 0) + 1 INTO v_order_number FROM public.orders WHERE business_id = p_business_id;

  INSERT INTO public.orders (
    business_id, customer_id, customer_name, customer_phone,
    items, total, status, consumption_option,
    address, notes, order_number, delivery_code,
    bairro, customer_lat, customer_lng, voice_note_url,
    payment_method, payment_proof_url, payment_status
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
    CASE WHEN p_payment_method = 'online' AND p_payment_proof_url IS NOT NULL THEN 'pendente' ELSE 'pendente' END
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_status_history (order_id, status, created_by)
  VALUES (v_order_id, 'novo', p_customer_id);

  -- Record activity
  BEGIN
    INSERT INTO public.provider_activity (provider_id, activity_type)
    VALUES (p_business_id, 'order');
  EXCEPTION WHEN others THEN NULL;
  END;

  -- Notify business owner
  SELECT user_id INTO v_owner_id FROM public.profiles WHERE id = p_business_id;
  IF v_owner_id IS NOT NULL AND v_owner_id IS DISTINCT FROM p_customer_id THEN
    PERFORM public.create_notification(
      v_owner_id,
      'Novo Pedido #' || v_order_number,
      btrim(p_customer_name) || ' fez um pedido de ' || p_total || ' FCFA',
      'order',
      'order',
      v_order_id
    );
  END IF;

  RETURN v_order_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- REVOKE: fechar o acesso do anon (e do PUBLIC) as funcoes sensiveis
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.get_business_orders(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_business_orders(uuid, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_customer_orders(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_customer_orders(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_order_history(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_order_history(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_delivery_tracking(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_delivery_tracking(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_delivery_orders(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_delivery_orders(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_business_appointments(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_business_appointments(uuid, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_customer_appointments(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_customer_appointments(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.create_order(uuid, uuid, text, text, jsonb, numeric, text, text, text, text, double precision, double precision, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_order(uuid, uuid, text, text, jsonb, numeric, text, text, text, text, double precision, double precision, text, text, text) TO authenticated, service_role;

-- Notificacoes: so utilizadores autenticados (o chat precisa de notificar terceiros)
REVOKE EXECUTE ON FUNCTION public.create_notification(uuid, text, text, text, text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_notification(uuid, text, text, text, text, uuid) TO authenticated, service_role;

-- Directorio BORNAAL: so utilizadores autenticados (evita enumeracao anonima)
REVOKE EXECUTE ON FUNCTION public.lookup_by_bornaal_id(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.lookup_by_bornaal_id(text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.search_bornaal_id(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.search_bornaal_id(text) TO authenticated, service_role;

-- Criacao de pedido legada (nao usada pelo frontend actual)
REVOKE EXECUTE ON FUNCTION public.record_business_order(uuid, jsonb, numeric, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.record_business_order(uuid, jsonb, numeric, text, text) TO authenticated, service_role;

-- Helpers internos: nunca chamados directamente pelo cliente
REVOKE EXECUTE ON FUNCTION public.calculate_quality_score(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_bornaal_id() FROM PUBLIC, anon, authenticated;
