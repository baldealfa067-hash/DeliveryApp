-- Taxa de entrega visivel ao cliente e ao restaurante.
--
-- §83, principio da nao surpresa: o cliente via a taxa no checkout e a partir
-- dai' ela desaparecia -- o acompanhamento e o historico mostravam so' o valor
-- da comida, que nao e' o que ele pagou. O restaurante tambem so' via o seu
-- proprio valor.
--
-- §28 e a decisao de 2026-09-10: no pagamento em dinheiro e' o motorista que
-- recebe o total e deve a comida ao restaurante. Para qualquer dos lados fazer
-- contas, os dois numeros tem de estar visiveis em separado -- e' por isso que
-- se expoe `delivery_fee` ao lado de `total`, e nao um total ja' somado.
--
-- `orders.total` continua a ser SO' a comida. Nao se toca nele: §27 separa as
-- duas parcelas de proposito, e a Fase 6 vai precisar delas separadas para o
-- ledger. Quem soma e' a interface (src/components/OrderTotals.tsx).
--
-- DROP + CREATE porque mudar o RETURNS TABLE nao e' possivel com CREATE OR
-- REPLACE. Isso apaga o ACL, portanto ele e' reposto explicitamente no fim --
-- medido antes: authenticated sim, anon nao, nos dois casos.
--
-- `get_order_history` NAO entra: devolve historico de estados (status, note,
-- created_at), nao valores. Nao tinha onde por a taxa.

DROP FUNCTION IF EXISTS public.get_customer_orders(uuid);
CREATE FUNCTION public.get_customer_orders(p_customer_id uuid)
RETURNS TABLE(id uuid, business_id uuid, business_name text, customer_id uuid,
              customer_name text, customer_phone text, items jsonb, total numeric,
              delivery_fee numeric, status text, consumption_option text,
              address text, notes text, order_number integer, preparation_time integer,
              delivery_code text, bairro text, voice_note_url text, payment_method text,
              payment_proof_url text, payment_status text,
              created_at timestamp with time zone)
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
    o.created_at
  FROM public.orders o
  LEFT JOIN public.profiles p ON p.id = o.business_id
  WHERE o.customer_id = p_customer_id
  ORDER BY o.created_at DESC;
END;
$function$;

DROP FUNCTION IF EXISTS public.get_business_orders(uuid, text);
CREATE FUNCTION public.get_business_orders(p_business_id uuid, p_status text DEFAULT NULL)
RETURNS TABLE(id uuid, business_id uuid, business_name text, customer_id uuid,
              customer_name text, customer_phone text, items jsonb, total numeric,
              delivery_fee numeric, status text, consumption_option text,
              address text, notes text, order_number integer, preparation_time integer,
              delivery_code text, bairro text, voice_note_url text, payment_method text,
              payment_proof_url text, payment_status text,
              created_at timestamp with time zone)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
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
    o.items, o.total, o.delivery_fee, o.status, o.consumption_option,
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

-- ACL reposto. Regra de 20260910033308: revogar dos DOIS, porque uma funcao
-- criada agora nasce com concessao explicita ao `anon` vinda dos default
-- privileges, e uma antiga trazia-a via PUBLIC.
REVOKE EXECUTE ON FUNCTION public.get_customer_orders(uuid)       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_business_orders(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_customer_orders(uuid)       TO authenticated;
GRANT  EXECUTE ON FUNCTION public.get_business_orders(uuid, text) TO authenticated;
