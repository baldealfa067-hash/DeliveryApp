-- FASE 7.2 -- criar um envio (§19). O MESMO dispatch, nenhuma linha paralela.
--
-- O fluxo do §19 e': Cliente -> Enviar -> Documento/Objecto -> Origem ->
-- Destino -> Indicacao de voz -> Preco da frota -> Cliente aceita -> Pedido
-- criado -> Frota -> Motorista. Tudo a partir de "Pedido criado" ja existe e
-- esta testado desde as Fases 3 e 5: esta RPC liga-se a esse maquinismo em vez
-- de o repetir.
--
-- NOTA DE LEITURA: a funcao `create_send_order` criada aqui e' SUBSTITUIDA na
-- migracao seguinte (20260916130817), que lhe fecha o pagamento online. Fica
-- aqui como esteve, porque o historico de migracoes e' registo do que
-- aconteceu, nao uma versao limpa a posteriori.

-- ---------------------------------------------------------------------------
-- 1. Coordenadas da recolha
-- ---------------------------------------------------------------------------
-- A 7.1 trouxe a morada e a voz da origem, mas nao as coordenadas. Sem elas a
-- distancia de um envio seria sempre NULL -- e num envio o cliente esta quase
-- sempre NO ponto de recolha quando faz o pedido, portanto o GPS dele e' a
-- melhor medida que alguma vez vamos ter da origem. §40 quer este dado para a
-- quilometragem da frota; nao entra no preco (§15).
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS pickup_lat double precision,
  ADD COLUMN IF NOT EXISTS pickup_lng double precision;

COMMENT ON COLUMN public.orders.pickup_lat IS
  'GPS da recolha (Fase 7.2). Opcional, como todo o GPS desde 2026-09-16: sem '
  'ele a entrega existe na mesma e a distancia fica NULL (§21, §40).';

-- ---------------------------------------------------------------------------
-- 2. A RPC (versao inicial -- ver a migracao seguinte)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_send_order(
  p_send_item_type        text,
  p_description           text,
  p_pickup_address        text,
  p_bairro                text,                 -- DESTINO: define preco e frota
  p_address               text,                 -- DESTINO
  p_customer_name         text,
  p_customer_phone        text,
  p_pickup_bairro         text DEFAULT NULL,
  p_pickup_voice_note_url text DEFAULT NULL,
  p_voice_note_url        text DEFAULT NULL,
  p_pickup_lat            double precision DEFAULT NULL,
  p_pickup_lng            double precision DEFAULT NULL,
  p_customer_lat          double precision DEFAULT NULL,
  p_customer_lng          double precision DEFAULT NULL,
  p_payment_method        text DEFAULT 'entrega'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order_id     uuid;
  v_order_number integer;
  v_delivery_id  uuid;
  v_fleet_id     uuid;
  v_fleet_name   text;
  v_preco        numeric;
  v_distance     double precision;
  v_notificados  integer;
  v_repetido     uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessao'; END IF;

  IF p_send_item_type IS NULL OR p_send_item_type NOT IN ('documento','objeto','outro') THEN
    RAISE EXCEPTION 'Diga o que vai enviar: documento, objeto ou outro';
  END IF;
  IF btrim(COALESCE(p_pickup_address,'')) = '' THEN
    RAISE EXCEPTION 'Falta dizer onde recolher';
  END IF;
  IF btrim(COALESCE(p_address,'')) = '' THEN
    RAISE EXCEPTION 'Falta dizer onde entregar';
  END IF;
  IF btrim(COALESCE(p_bairro,'')) = '' THEN
    RAISE EXCEPTION 'Falta o bairro de destino';
  END IF;
  IF btrim(COALESCE(p_customer_phone,'')) = '' THEN
    RAISE EXCEPTION 'Telefone obrigatorio: o motorista precisa de ligar';
  END IF;
  IF p_payment_method NOT IN ('entrega','online') THEN
    RAISE EXCEPTION 'Metodo de pagamento invalido';
  END IF;

  -- PRECO E FROTA, pelo bairro de DESTINO. §13/§15: o preco e' por zona, nao
  -- por distancia; §16 poe origem->destino no futuro. O `pickup_bairro` fica
  -- guardado para essa evolucao, mas hoje nao entra na conta.
  SELECT gp.fleet_id, gp.fleet_name, gp.preco
  INTO v_fleet_id, v_fleet_name, v_preco
  FROM public.get_delivery_price(p_bairro) gp;

  -- RECUSAR SE NINGUEM COBRE O DESTINO, em vez de criar um envio sem frota.
  -- §14 diz que o cliente aceita um PRECO antes de o pedido ser confirmado --
  -- sem frota nao ha preco, portanto nao ha nada para ele aceitar. E um envio
  -- criado sem frota ficava parado para sempre: nao tem restaurante que o
  -- reofereca, o expire_stale_dispatch nao lhe toca (a ronda nasceria
  -- 'sem_frota', fechada) e o alert_stuck_orders tambem nao (tem entrega).
  IF v_fleet_id IS NULL THEN
    RAISE EXCEPTION 'Ainda nao ha nenhuma frota a entregar em "%". Tente outro bairro.', p_bairro;
  END IF;

  -- §73 -- duplo toque, ligacao lenta, retry. Nao ha chave natural de
  -- idempotencia num envio, portanto usa-se a assinatura do pedido numa janela
  -- curta: mesmo cliente, mesma origem, mesmo destino, ainda por aceitar.
  SELECT o.id INTO v_repetido
  FROM public.orders o
  WHERE o.kind = 'envio'
    AND o.customer_id = auth.uid()
    AND o.status = 'aguardando_motorista'
    AND btrim(COALESCE(o.pickup_address,'')) = btrim(p_pickup_address)
    AND btrim(COALESCE(o.address,''))        = btrim(p_address)
    AND o.created_at > now() - interval '90 seconds'
  LIMIT 1;

  IF v_repetido IS NOT NULL THEN
    -- Devolve-se o pedido JA criado em vez de rebentar: para quem tocou duas
    -- vezes, o resultado certo e' "esta feito", nao um erro (§72).
    SELECT o.order_number, o.delivery_fee INTO v_order_number, v_preco
    FROM public.orders o WHERE o.id = v_repetido;
    RETURN jsonb_build_object(
      'order_id', v_repetido, 'order_number', v_order_number,
      'delivery_fee', v_preco, 'fleet_name', v_fleet_name,
      'repetido', true);
  END IF;

  -- DISTANCIA: so quando ha coordenadas dos DOIS lados. NULL, nunca 0 -- a
  -- mesma disciplina da entrega sem GPS (§40).
  IF p_pickup_lat IS NOT NULL AND p_pickup_lng IS NOT NULL
     AND p_customer_lat IS NOT NULL AND p_customer_lng IS NOT NULL THEN
    v_distance := 6371 * acos(
      LEAST(1.0, GREATEST(-1.0,
        cos(radians(p_pickup_lat)) * cos(radians(p_customer_lat)) *
        cos(radians(p_customer_lng) - radians(p_pickup_lng)) +
        sin(radians(p_pickup_lat)) * sin(radians(p_customer_lat))
      )));
  ELSE
    v_distance := NULL;
  END IF;

  -- O PEDIDO. `total = 0` e `business_id` NULL nao sao descuido: e' o que o
  -- CHECK orders_kind_coerente exige, e e' o que faz o ledger escrever so a
  -- comissao da frota (§26) e mais nada. `order_number` fica ao DEFAULT
  -- (sequencia global) -- o contador por restaurante nao se aplica.
  INSERT INTO public.orders (
    kind, business_id, customer_id, customer_name, customer_phone,
    items, total, status, consumption_option,
    address, bairro, customer_lat, customer_lng, voice_note_url,
    pickup_address, pickup_bairro, pickup_lat, pickup_lng, pickup_voice_note_url,
    send_item_type, notes, payment_method, payment_status,
    fleet_id, delivery_fee, delivery_code, source
  ) VALUES (
    'envio', NULL, auth.uid(), btrim(p_customer_name), btrim(p_customer_phone),
    '[]'::jsonb, 0, 'aguardando_motorista', 'entrega',
    btrim(p_address), btrim(p_bairro), p_customer_lat, p_customer_lng, p_voice_note_url,
    btrim(p_pickup_address), NULLIF(btrim(COALESCE(p_pickup_bairro,'')),''),
    p_pickup_lat, p_pickup_lng, p_pickup_voice_note_url,
    p_send_item_type, NULLIF(btrim(COALESCE(p_description,'')),''),
    p_payment_method, 'pendente',
    v_fleet_id, v_preco,
    lpad((floor(random() * 1000000))::text, 6, '0'), 'app'
  ) RETURNING id, order_number INTO v_order_id, v_order_number;

  -- A ENTREGA. `restaurant_*` e' o ponto de RECOLHA -- colunas com nome infeliz
  -- e significado generico (ver a auditoria da Fase 7). E' por isto que a
  -- Fase 7.0 teve de passar os JOIN a profiles para LEFT: daqui para a frente
  -- nao ha restaurante nenhum para juntar.
  INSERT INTO public.deliveries (
    order_id, status, fleet_id, delivery_fee,
    restaurant_lat, restaurant_lng, restaurant_address,
    customer_lat, customer_lng, customer_address, distance_km
  ) VALUES (
    v_order_id, 'pendente', v_fleet_id, v_preco,
    p_pickup_lat, p_pickup_lng, btrim(p_pickup_address),
    p_customer_lat, p_customer_lng, btrim(p_address),
    CASE WHEN v_distance IS NULL THEN NULL ELSE round(v_distance::numeric, 2) END
  ) RETURNING id INTO v_delivery_id;

  -- O MESMO DISPATCH das Fases 3 e 5: regista a ronda em `dispatch_attempts`,
  -- notifica os motoristas DESTA frota, e entra no ciclo de expiracao sem que
  -- seja preciso dizer-lhe nada.
  v_notificados := public.offer_delivery_to_fleet(v_delivery_id, 1);

  INSERT INTO public.order_status_history (order_id, status, note, created_by)
  VALUES (v_order_id, 'aguardando_motorista',
          '[Envio criado pelo cliente. ' || v_notificados || ' motorista(s) notificado(s)]',
          auth.uid());

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'delivery_id', v_delivery_id,
    'delivery_fee', v_preco,
    'fleet_name', v_fleet_name,
    'motoristas_notificados', v_notificados,
    'repetido', false
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_send_order(text,text,text,text,text,text,text,text,text,text,double precision,double precision,double precision,double precision,text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_send_order(text,text,text,text,text,text,text,text,text,text,double precision,double precision,double precision,double precision,text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. O aviso ao cliente deixa de falar de um restaurante que nao existe
-- ---------------------------------------------------------------------------
-- `notify_new_order` dizia sempre "O seu pedido foi recebido pelo restaurante."
-- Num envio nao ha restaurante nenhum, e o que o cliente precisa de saber e'
-- outra coisa: que ja se anda a procurar motorista (§52).
DO $do$
DECLARE
  v_def  text;
  v_novo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='notify_new_order';
  IF v_def IS NULL THEN RAISE EXCEPTION 'notify_new_order nao encontrada'; END IF;

  v_novo := replace(v_def,
    '      ''Pedido #'' || NEW.order_number || '' Criado'',' || chr(10) ||
    '      ''O seu pedido foi recebido pelo restaurante.'',',
    '      CASE WHEN NEW.kind = ''envio''' || chr(10) ||
    '           THEN ''Envio #'' || NEW.order_number || '' criado''' || chr(10) ||
    '           ELSE ''Pedido #'' || NEW.order_number || '' Criado'' END,' || chr(10) ||
    '      CASE WHEN NEW.kind = ''envio''' || chr(10) ||
    '           THEN ''Estamos a procurar um motorista para a sua recolha.''' || chr(10) ||
    '           ELSE ''O seu pedido foi recebido pelo restaurante.'' END,');
  IF v_novo = v_def THEN RAISE EXCEPTION 'nao encontrei o aviso ao cliente'; END IF;

  EXECUTE v_novo;

  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='notify_new_order';
  IF v_def NOT LIKE '%Estamos a procurar um motorista para a sua recolha.%' THEN
    RAISE EXCEPTION 'o texto do envio nao entrou';
  END IF;
  IF v_def NOT LIKE '%O seu pedido foi recebido pelo restaurante.%' THEN
    RAISE EXCEPTION 'o texto do restaurante desapareceu';
  END IF;
END
$do$;
