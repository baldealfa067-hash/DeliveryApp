-- FASE 7.0 -- desarmar os JOIN que fazem desaparecer um pedido sem restaurante.
--
-- PREPARACAO para a categoria "Enviar" (§19). NAO acrescenta funcionalidade
-- nenhuma e NAO muda nada para os restaurantes em producao: um INNER JOIN e um
-- LEFT JOIN dao exactamente o mesmo resultado enquanto `business_id` for NOT
-- NULL, que continua a ser depois desta migracao. Isto vai sozinho de
-- proposito, porque toca no ecra de que depende a operacao dos motoristas.
--
-- ===========================================================================
-- A AUDITORIA CONTOU 7 FUNCOES. SAO 4. A correccao importa mais do que o numero
-- ===========================================================================
-- Ao ler o CONTEXTO de cada join, eles dividem-se em tres familias, e so uma
-- delas e' um defeito:
--
--   (A) JOIN QUE FILTRA LINHAS -- o pedido desaparece. E' o defeito.
--       get_available_deliveries, get_my_deliveries, alert_stuck_orders
--
--   (B) JOIN QUE SO LE UM DADO (SELECT ... INTO) -- o pedido nao desaparece,
--       mas perde-se o numero dele e os avisos saem como "Pedido #?".
--       expire_stale_dispatch
--
--   (C) JOIN QUE AUTORIZA -- tem de CONTINUAR INNER.
--       reoffer_delivery, validate_order_payment
--       Um envio nao tem dono de restaurante, portanto nenhum dono de
--       restaurante o pode reoferecer nem validar-lhe o pagamento. Passar estes
--       a LEFT JOIN nao abriria buraco por acaso (`p.user_id = auth.uid()`
--       nunca casa com NULL), mas escreveria no codigo a ideia errada de que o
--       caso e' para acomodar. NAO SE TOCA -- e ha uma assercao no fim que
--       rebenta se alguem os "corrigir" mais tarde.
--
--   (D) notify_delivery_accepted -- NAO precisa de nada. A notificacao ao
--       CLIENTE vem de uma consulta separada a `orders`, sem `profiles`; so a
--       do restaurante depende do join, e ja' esta guardada por
--       `IF v_business_owner_id IS NOT NULL`. Um envio avisa o cliente e nao
--       avisa restaurante nenhum -- que e' exactamente o correcto.
--
-- O QUE MOSTRAR NO LUGAR DO NOME DO RESTAURANTE: `deliveries.restaurant_address`
-- ja' e' o ponto de recolha (colunas nullable, nome infeliz -- ver a auditoria).
-- Serve hoje, sem depender de nenhuma coluna que so' chega na Fase 7.1.

DO $do$
DECLARE
  v_def  text;
  v_novo text;
BEGIN
  -- (A1) get_available_deliveries -- o mais critico. Sem isto, uma entrega de
  -- documento NUNCA e' oferecida a motorista nenhum: lista vazia, HTTP 200.
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='get_available_deliveries';
  IF v_def IS NULL THEN RAISE EXCEPTION 'get_available_deliveries nao encontrada'; END IF;

  v_novo := replace(v_def,
    'JOIN public.profiles p ON p.id = o.business_id',
    'LEFT JOIN public.profiles p ON p.id = o.business_id');
  IF v_novo = v_def THEN RAISE EXCEPTION 'get_available_deliveries: join nao encontrado'; END IF;
  v_def := v_novo;

  v_novo := replace(v_def,
    'p.name AS restaurant_name,',
    'COALESCE(p.name, NULLIF(btrim(d.restaurant_address), ''''), ''Ponto de recolha'') AS restaurant_name,');
  IF v_novo = v_def THEN RAISE EXCEPTION 'get_available_deliveries: nome nao encontrado'; END IF;
  EXECUTE v_novo;

  -- (A2) get_my_deliveries -- depois de aceite, desaparecia da mao do motorista.
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='get_my_deliveries';
  IF v_def IS NULL THEN RAISE EXCEPTION 'get_my_deliveries nao encontrada'; END IF;

  v_novo := replace(v_def,
    'JOIN public.profiles rp ON rp.id = o.business_id',
    'LEFT JOIN public.profiles rp ON rp.id = o.business_id');
  IF v_novo = v_def THEN RAISE EXCEPTION 'get_my_deliveries: join nao encontrado'; END IF;
  v_def := v_novo;

  v_novo := replace(v_def,
    'rp.name AS restaurant_name, rp.phone AS restaurant_phone,',
    'COALESCE(rp.name, NULLIF(btrim(d.restaurant_address), ''''), ''Ponto de recolha'') AS restaurant_name, rp.phone AS restaurant_phone,');
  IF v_novo = v_def THEN RAISE EXCEPTION 'get_my_deliveries: nome nao encontrado'; END IF;
  EXECUTE v_novo;

  -- (A3) alert_stuck_orders -- a rede de seguranca da Fase 2.2 nao apanhava o
  -- caso. O `dono` ja' esta guardado por IF ... IS NOT NULL la dentro, portanto
  -- um envio preso avisa o ADMIN e nao avisa restaurante nenhum. Correcto.
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='alert_stuck_orders';
  IF v_def IS NULL THEN RAISE EXCEPTION 'alert_stuck_orders nao encontrada'; END IF;

  v_novo := replace(v_def,
    'JOIN public.profiles p ON p.id = o.business_id',
    'LEFT JOIN public.profiles p ON p.id = o.business_id');
  IF v_novo = v_def THEN RAISE EXCEPTION 'alert_stuck_orders: join nao encontrado'; END IF;
  EXECUTE v_novo;

  -- (B) expire_stale_dispatch -- aqui o pedido NAO desaparecia (o ciclo corre
  -- sobre dispatch_attempts). O que se perdia era o `order_number`.
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='expire_stale_dispatch';
  IF v_def IS NULL THEN RAISE EXCEPTION 'expire_stale_dispatch nao encontrada'; END IF;

  v_novo := replace(v_def,
    'JOIN public.profiles p ON p.id = o.business_id',
    'LEFT JOIN public.profiles p ON p.id = o.business_id');
  IF v_novo = v_def THEN RAISE EXCEPTION 'expire_stale_dispatch: join nao encontrado'; END IF;
  EXECUTE v_novo;
END
$do$;

-- ---------------------------------------------------------------------------
-- Verificacao do que ficou MESMO instalado
-- ---------------------------------------------------------------------------
-- Conta ocorrencias em vez de usar lookbehind: o Postgres nao tem `(?<!...)`.
-- Como 'LEFT JOIN public.profiles' CONTEM 'JOIN public.profiles', os dois
-- numeros so batem certo se TODOS os joins a profiles forem LEFT.
DO $do$
DECLARE
  r       record;
  v_todos integer;
  v_left  integer;
  v_conta integer;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN ('get_available_deliveries','get_my_deliveries',
                        'alert_stuck_orders','expire_stale_dispatch')
  LOOP
    v_todos := (length(r.def) - length(replace(r.def, 'JOIN public.profiles', '')))
               / length('JOIN public.profiles');
    v_left  := (length(r.def) - length(replace(r.def, 'LEFT JOIN public.profiles', '')))
               / length('LEFT JOIN public.profiles');
    IF v_todos = 0 THEN
      RAISE EXCEPTION '%: perdeu o join a profiles por completo', r.proname;
    END IF;
    IF v_todos <> v_left THEN
      RAISE EXCEPTION '%: % join(s) a profiles, so % sao LEFT', r.proname, v_todos, v_left;
    END IF;
  END LOOP;

  -- As duas que MOSTRAM nome tem de ter o COALESCE.
  SELECT count(*) INTO v_conta FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('get_available_deliveries','get_my_deliveries')
    AND pg_get_functiondef(p.oid) LIKE '%Ponto de recolha%';
  IF v_conta <> 2 THEN
    RAISE EXCEPTION 'esperava 2 funcoes com COALESCE no nome, encontrei %', v_conta;
  END IF;

  -- As de AUTORIZACAO tem de continuar INNER.
  SELECT count(*) INTO v_conta FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('reoffer_delivery','validate_order_payment')
    AND pg_get_functiondef(p.oid) LIKE '%LEFT JOIN public.profiles%';
  IF v_conta <> 0 THEN
    RAISE EXCEPTION 'uma funcao de autorizacao passou a LEFT JOIN -- nao e para acomodar envios';
  END IF;
END
$do$;
