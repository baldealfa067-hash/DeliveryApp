-- Indicacao de voz da localizacao do restaurante.
--
-- O restaurante grava UMA vez, no perfil, e essa gravacao passa a servir todos
-- os pedidos dele. Ate aqui a unica voz de recolha era a dos ENVIOS (Fase 7.3),
-- gravada pelo cliente a cada pedido; um pedido de restaurante nunca tinha voz
-- de origem, e o motorista so tinha a morada.
--
-- Sem gravacao o motorista simplesmente nao ouve nada dessa parte: nem erro, nem
-- pedido bloqueado. E o mesmo default seguro do horario ("sem horario = sempre
-- aberto") -- ha restaurantes reais em producao que nunca vao abrir este ecra.

-- ----------------------------------------------------------------- coluna ---
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS location_voice_url text;

COMMENT ON COLUMN public.profiles.location_voice_url IS
  'Nome do objecto no bucket privado notas-voz (<uid>/<ficheiro>), NUNCA uma URL. '
  'Indicacao falada de onde o negocio fica, gravada uma vez e usada em todos os '
  'pedidos. Escreve-se so por set_business_location_voice, que valida que o '
  'ficheiro e da pasta do proprio: um UPDATE directo deixaria o restaurante '
  'apontar para a nota de voz de outra pessoa, e a policy de leitura daria essa '
  'gravacao aos motoristas dele. Coluna PRIVADA -- fora de PUBLIC_PROFILE_COLUMNS '
  'e sem GRANT: o dono le-a por get_my_profile_private, o motorista por '
  'get_my_deliveries.';

-- ------------------------------------------------------------ quem ouve ---
-- Uma voz de PERFIL nao esta ligada a pedido nenhum, portanto as tres vias que
-- a funcao ja tinha (pasta propria, admin, ligacao a um pedido) deixavam o
-- motorista de fora. Acrescenta-se uma quarta via, e SO ela: motorista com uma
-- entrega desse restaurante POR CONCLUIR.
--
-- A janela e deliberada (decisao do dono, 2026-09-21) e e a mesma ja usada para
-- o telefone do motorista: o acesso dura enquanto durar o trabalho. Um motorista
-- que entregou ha seis meses deixa de ouvir a gravacao actual do restaurante.
CREATE OR REPLACE FUNCTION public.pode_ouvir_nota_voz(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL AND (
    split_part(p_name, '/', 1) = auth.uid()::text
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.orders o
      WHERE (o.voice_note_url = p_name OR o.pickup_voice_note_url = p_name)
        AND (
          o.customer_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = o.business_id AND p.user_id = auth.uid())
          OR EXISTS (
            SELECT 1 FROM public.deliveries d
            JOIN public.drivers dr ON dr.id = d.driver_id
            WHERE d.order_id = o.id AND dr.user_id = auth.uid()
          )
        )
    )
    -- Voz de localizacao do restaurante: motorista com entrega por concluir.
    OR EXISTS (
      SELECT 1
      FROM public.deliveries d
      JOIN public.drivers dr ON dr.id = d.driver_id
      JOIN public.orders o    ON o.id = d.order_id
      JOIN public.profiles p  ON p.id = o.business_id
      WHERE dr.user_id = auth.uid()
        AND p.location_voice_url = p_name
        AND d.status NOT IN ('entregue', 'cancelado')
    )
  );
$function$;

COMMENT ON FUNCTION public.pode_ouvir_nota_voz(text) IS
  'Quem pode abrir um objecto do bucket notas-voz. Quatro vias: dono da pasta, '
  'admin, participante num pedido a que a voz esteja ligada, e motorista com '
  'entrega POR CONCLUIR de um restaurante cuja voz de localizacao seja esta. '
  'A quarta via existe porque uma voz de perfil nao esta ligada a pedido nenhum.';

-- ---------------------------------------------------------------- gravar ---
-- Porque isto e RPC e nao um UPDATE directo em profiles: sem validacao, o
-- restaurante escrevia na coluna o nome da nota de voz de OUTRO cliente e, pela
-- policy acima, os motoristas dele passavam a ouvir a morada falada de um
-- estranho. E o mesmo buraco que o create_order fechou a 2026-09-17.
--
-- Devolve a referencia ANTERIOR para o cliente poder apagar o ficheiro velho: o
-- requisito e substituir, nao acumular. A ordem e a mesma do script de migracao
-- -- a base de dados primeiro, o ficheiro depois -- porque um ficheiro apagado
-- com a coluna ainda a apontar-lhe deixava o motorista com um audio partido.
CREATE OR REPLACE FUNCTION public.set_business_location_voice(
  p_business_id uuid,
  p_ref text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ref      text := NULLIF(btrim(COALESCE(p_ref, '')), '');
  v_anterior text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessao'; END IF;
  IF NOT public.is_business_owner(p_business_id)
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'So o dono pode gravar a indicacao de voz do negocio';
  END IF;

  -- Tem de existir e ser da pasta do proprio. Deixa passar NULL (apagar).
  IF v_ref IS NOT NULL THEN
    PERFORM public.assert_nota_voz_do_proprio(v_ref);
  END IF;

  SELECT p.location_voice_url INTO v_anterior
  FROM public.profiles p WHERE p.id = p_business_id;

  UPDATE public.profiles SET location_voice_url = v_ref WHERE id = p_business_id;

  -- NULL quando nao mudou nada: quem chama nao deve apagar o ficheiro que
  -- acabou de gravar so porque a referencia se repetiu.
  RETURN CASE WHEN v_anterior IS DISTINCT FROM v_ref THEN v_anterior ELSE NULL END;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_business_location_voice(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_business_location_voice(uuid, text) TO authenticated;

-- ------------------------------------------------- o dono le a sua coluna ---
-- DROP e nao CREATE OR REPLACE: acrescentar uma coluna ao RETURNS TABLE muda o
-- tipo de retorno, e o replace recusa. O DROP leva os GRANTs, que sao repostos
-- a seguir -- esquece-los deixava a funcao inacessivel ao frontend.
DROP FUNCTION IF EXISTS public.get_my_profile_private();
CREATE FUNCTION public.get_my_profile_private()
RETURNS TABLE(merchant_code text, payment_number text, verification_doc_url text,
              verification_selfie_url text, verification_reason text,
              orange_money_method text, location_voice_url text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sem sessao';
  END IF;
  RETURN QUERY
  SELECT p.merchant_code, p.payment_number,
         p.verification_doc_url, p.verification_selfie_url, p.verification_reason,
         p.orange_money_method, p.location_voice_url
  FROM public.profiles p WHERE p.user_id = auth.uid();
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_profile_private() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile_private() TO authenticated, service_role;

-- ------------------------------------------------ o motorista recebe a voz ---
-- Ja havia LEFT JOIN a profiles (o rp), portanto e so mais uma coluna. O LEFT e
-- de proposito e nao se troca por INNER: um ENVIO nao tem restaurante, e um
-- INNER fazia-o desaparecer da lista sem erro nenhum (armadilha da Fase 7).
DROP FUNCTION IF EXISTS public.get_my_deliveries();
CREATE FUNCTION public.get_my_deliveries()
RETURNS TABLE(id uuid, order_id uuid, order_number integer, restaurant_name text,
              restaurant_phone text, restaurant_address text, customer_name text,
              customer_phone text, customer_address text, distance_km double precision,
              delivery_fee numeric, order_total numeric, items jsonb,
              payment_method text, payment_status text, status text,
              accepted_at timestamp with time zone, picked_up_at timestamp with time zone,
              delivered_at timestamp with time zone, created_at timestamp with time zone,
              restaurant_lat double precision, restaurant_lng double precision,
              customer_lat double precision, customer_lng double precision,
              voice_note_url text, pickup_voice_note_url text,
              restaurant_voice_note_url text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_driver_id uuid;
BEGIN
  SELECT drivers.id INTO v_driver_id FROM public.drivers WHERE user_id = auth.uid();
  IF v_driver_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT d.id, d.order_id, o.order_number,
         COALESCE(rp.name, NULLIF(btrim(d.restaurant_address), ''), 'Ponto de recolha') AS restaurant_name,
         rp.phone AS restaurant_phone,
         d.restaurant_address,
         o.customer_name, o.customer_phone,
         d.customer_address, d.distance_km, d.delivery_fee,
         o.total AS order_total, o.items,
         COALESCE(o.payment_method, 'entrega') AS payment_method,
         COALESCE(o.payment_status, 'pendente') AS payment_status,
         d.status, d.accepted_at, d.picked_up_at, d.delivered_at, d.created_at,
         d.restaurant_lat, d.restaurant_lng,
         d.customer_lat, d.customer_lng,
         o.voice_note_url,
         o.pickup_voice_note_url,
         -- So enquanto a entrega esta por concluir, para bater certo com o que a
         -- policy do bucket deixa abrir. Devolver o nome depois de entregue dava
         -- ao painel uma referencia que o Storage ja recusa assinar: um leitor
         -- partido no ecra em vez de nada, que e pior.
         CASE WHEN d.status NOT IN ('entregue', 'cancelado')
              THEN rp.location_voice_url END AS restaurant_voice_note_url
  FROM public.deliveries d
  JOIN public.orders o ON o.id = d.order_id
  LEFT JOIN public.profiles rp ON rp.id = o.business_id
  WHERE d.driver_id = v_driver_id
  ORDER BY d.created_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_deliveries() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_deliveries() TO authenticated, service_role;
