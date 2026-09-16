-- FASE 7.2 (correccao) -- o ledger de um envio.
--
-- A auditoria da Fase 7 afirmou que "o ledger nao precisa de alteracao nenhuma"
-- porque, com `total = 0`, os blocos da comissao do restaurante (§25) e da
-- divida de comida (§28) se saltam sozinhos. Essa parte estava certa. O que
-- passou ao lado foi a GUARDA NO TOPO da funcao:
--
--     IF v_business_id IS NULL THEN RETURN; END IF;
--
-- Um envio nao tem restaurante, portanto a funcao saia logo ali e NAO escrevia
-- nada -- nem sequer a comissao da frota. Apanhado pelo teste de ponta a ponta
-- da 7.2: a entrega concluia, o motorista era pago pelo cliente, e a plataforma
-- nao registava a comissao a que tinha direito (§26). Silencioso, como todos os
-- defeitos desta familia.
--
-- A guarda tinha uma intencao legitima -- "nao ha nada para lancar, sai" -- e
-- passa a dize-lo com precisao: so nao ha nada para lancar quando NAO ha
-- restaurante E NAO ha frota. Se o pedido nem existe, ambas sao NULL e a funcao
-- sai como saia antes.
--
-- E UMA BOMBA POR REBENTAR, encontrada a ler o resto da funcao: o bloco 4
-- (pagamento online) dispara com `v_fleet_id IS NOT NULL AND v_delivery_fee > 0`
-- e escreve `divida_entrega` com `account_kind='business'`. Num envio o
-- `business_id` e NULL, e essa linha batia no CHECK `ledger_entries_conta_
-- coerente` -- ou seja, rebentava NA CONCLUSAO, depois do trabalho feito.
-- Nunca chegou a acontecer porque a guarda de cima ja matava tudo antes; ao
-- levantar a guarda, passaria a acontecer. Fica fechado no mesmo passo.

DO $do$
DECLARE
  v_def  text;
  v_novo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='ledger_registar_conclusao';
  IF v_def IS NULL THEN RAISE EXCEPTION 'ledger_registar_conclusao nao encontrada'; END IF;

  -- (a) a guarda deixa de excluir os envios
  v_novo := replace(v_def,
    '  IF v_business_id IS NULL THEN RETURN; END IF;',
    '  -- FASE 7.2: um ENVIO nao tem restaurante e tem de continuar -- o que ha' || chr(10) ||
    '  -- para lancar e a comissao da frota (§26). So nao ha nada a fazer quando' || chr(10) ||
    '  -- nao ha restaurante NEM frota (o que inclui o pedido inexistente).' || chr(10) ||
    '  IF v_business_id IS NULL AND v_fleet_id IS NULL THEN RETURN; END IF;');
  IF v_novo = v_def THEN RAISE EXCEPTION 'nao encontrei a guarda inicial'; END IF;
  v_def := v_novo;

  -- (b) o bloco do pagamento online exige um restaurante que receba
  v_novo := replace(v_def,
    '  IF v_payment = ''online'' AND v_fleet_id IS NOT NULL AND v_delivery_fee > 0 THEN',
    '  -- FASE 7.2: `v_business_id IS NOT NULL` porque este bloco escreve numa' || chr(10) ||
    '  -- conta de RESTAURANTE. Num envio nao ha nenhum, e a linha batia no CHECK' || chr(10) ||
    '  -- ledger_entries_conta_coerente ja depois de a entrega estar feita.' || chr(10) ||
    '  IF v_payment = ''online'' AND v_business_id IS NOT NULL' || chr(10) ||
    '     AND v_fleet_id IS NOT NULL AND v_delivery_fee > 0 THEN');
  IF v_novo = v_def THEN RAISE EXCEPTION 'nao encontrei o bloco do pagamento online'; END IF;

  EXECUTE v_novo;

  -- Verificar o que ficou instalado.
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='ledger_registar_conclusao';

  IF v_def NOT LIKE '%v_business_id IS NULL AND v_fleet_id IS NULL THEN RETURN%' THEN
    RAISE EXCEPTION 'a guarda nova nao entrou';
  END IF;
  IF v_def LIKE '%IF v_business_id IS NULL THEN RETURN; END IF;%' THEN
    RAISE EXCEPTION 'a guarda antiga sobreviveu';
  END IF;
  IF v_def NOT LIKE '%v_payment = ''online'' AND v_business_id IS NOT NULL%' THEN
    RAISE EXCEPTION 'o bloco online nao ficou protegido';
  END IF;
  IF v_def NOT LIKE '%comissao_restaurante%' OR v_def NOT LIKE '%comissao_frota%'
     OR v_def NOT LIKE '%divida_comida%'     OR v_def NOT LIKE '%credito_entrega%' THEN
    RAISE EXCEPTION 'a funcao perdeu tipos de lancamento';
  END IF;
  IF v_def NOT LIKE '%v_source <> ''manual''%' THEN
    RAISE EXCEPTION 'perdeu a isencao do pedido manual';
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- Um envio paga-se ao motorista, nao online
-- ---------------------------------------------------------------------------
-- §23: o pagamento online usa o `merchant_code` do PARCEIRO. Um envio nao tem
-- parceiro nenhum -- nao ha a quem pagar online. Aceitar 'online' num envio era
-- prometer um caminho de pagamento que nao existe. Fica so dinheiro na entrega
-- (§22), que e' o modelo da V1. Esta e a unica diferenca para a versao criada
-- na migracao anterior.
CREATE OR REPLACE FUNCTION public.create_send_order(
  p_send_item_type        text,
  p_description           text,
  p_pickup_address        text,
  p_bairro                text,
  p_address               text,
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
  -- Ver o comentario acima: um envio nao tem parceiro com merchant_code.
  IF COALESCE(p_payment_method,'entrega') <> 'entrega' THEN
    RAISE EXCEPTION 'Um envio paga-se ao motorista na entrega';
  END IF;

  SELECT gp.fleet_id, gp.fleet_name, gp.preco
  INTO v_fleet_id, v_fleet_name, v_preco
  FROM public.get_delivery_price(p_bairro) gp;

  IF v_fleet_id IS NULL THEN
    RAISE EXCEPTION 'Ainda nao ha nenhuma frota a entregar em "%". Tente outro bairro.', p_bairro;
  END IF;

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
    SELECT o.order_number, o.delivery_fee INTO v_order_number, v_preco
    FROM public.orders o WHERE o.id = v_repetido;
    RETURN jsonb_build_object(
      'order_id', v_repetido, 'order_number', v_order_number,
      'delivery_fee', v_preco, 'fleet_name', v_fleet_name,
      'repetido', true);
  END IF;

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
    'entrega', 'pendente',
    v_fleet_id, v_preco,
    lpad((floor(random() * 1000000))::text, 6, '0'), 'app'
  ) RETURNING id, order_number INTO v_order_id, v_order_number;

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

COMMENT ON FUNCTION public.create_send_order(text,text,text,text,text,text,text,text,text,text,double precision,double precision,double precision,double precision,text) IS
  'Fase 7.2 (§19): cria um envio de documento/objecto. Mesma tabela `orders` '
  '(kind=envio, sem restaurante, total 0) e MESMO dispatch das Fases 3 e 5. '
  'Recusa se nenhuma frota cobrir o bairro de destino -- sem frota nao ha preco '
  'para o cliente aceitar (§14). So dinheiro na entrega: um envio nao tem '
  'parceiro com merchant_code (§23). Idempotente numa janela de 90s (§73).';

REVOKE EXECUTE ON FUNCTION public.create_send_order(text,text,text,text,text,text,text,text,text,text,double precision,double precision,double precision,double precision,text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_send_order(text,text,text,text,text,text,text,text,text,text,double precision,double precision,double precision,double precision,text) TO authenticated;
