-- Checkout e contacto (2026-09-17) — o cliente liga ao restaurante e ao motorista
-- a partir do acompanhamento do pedido.
--
-- `get_customer_orders` passa a devolver:
--   business_phone  — `profiles.phone`, já público (decisão de 2026-09-09).
--   driver_name,
--   driver_phone    — SÓ enquanto o motorista está com o pedido
--                     (motorista_encontrado, pedido_recolhido, a_caminho).
--                     Fora dessa janela vêm NULL.
--
-- `drivers` continua fechado (própria linha + admin): é a RPC SECURITY DEFINER que
-- decide o que expor, como nas RPCs da frota. NÃO acrescentar policy em `drivers`
-- para isto — abria a tabela inteira a todos os clientes.
--
-- Mudar o RETURNS TABLE obriga a DROP + CREATE; os GRANT vão de volta no fim.

DROP FUNCTION IF EXISTS public.get_customer_orders(uuid);

CREATE FUNCTION public.get_customer_orders(p_customer_id uuid)
RETURNS TABLE(id uuid, business_id uuid, business_name text, customer_id uuid,
              customer_name text, customer_phone text, items jsonb, total numeric,
              delivery_fee numeric, status text, consumption_option text,
              address text, notes text, order_number integer, preparation_time integer,
              delivery_code text, bairro text, voice_note_url text, payment_method text,
              payment_proof_url text, payment_status text,
              created_at timestamp with time zone,
              business_phone text, driver_name text, driver_phone text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
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
    o.items, o.total, o.delivery_fee, o.status, o.consumption_option,
    o.address, o.notes, o.order_number, o.preparation_time,
    o.delivery_code, o.bairro, o.voice_note_url,
    COALESCE(o.payment_method, 'entrega') AS payment_method,
    o.payment_proof_url,
    COALESCE(o.payment_status, 'pendente') AS payment_status,
    o.created_at,
    NULLIF(btrim(p.phone), '') AS business_phone,
    CASE WHEN o.status IN ('motorista_encontrado', 'pedido_recolhido', 'a_caminho')
         THEN mot.name END AS driver_name,
    CASE WHEN o.status IN ('motorista_encontrado', 'pedido_recolhido', 'a_caminho')
         THEN NULLIF(btrim(mot.phone), '') END AS driver_phone
  FROM public.orders o
  -- LEFT: um envio (Fase 7) não tem restaurante e não pode desaparecer da lista.
  LEFT JOIN public.profiles p ON p.id = o.business_id
  -- A entrega pode ter sido reoferecida (Fase 5): conta o motorista que aceitou
  -- por último.
  LEFT JOIN LATERAL (
    SELECT dr.name, dr.phone
    FROM public.deliveries d
    JOIN public.drivers dr ON dr.id = d.driver_id
    WHERE d.order_id = o.id
    ORDER BY d.accepted_at DESC NULLS LAST, d.created_at DESC
    LIMIT 1
  ) mot ON true
  WHERE o.customer_id = p_customer_id
  ORDER BY o.created_at DESC;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_customer_orders(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_customer_orders(uuid) TO authenticated;
