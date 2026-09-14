-- NOTA SOBRE A VERSAO DESTE FICHEIRO
-- 20260914192238 e' a hora REAL da aplicacao, nao um numero escolhido a mao.
-- Foi aplicada por `apply_migration`, que carimba a versao com a hora a que
-- corre -- e um nome de ficheiro inventado diverge em silencio, como aconteceu
-- com 20260914085117 (ver commit 0be548b). Nome e versao nascem iguais.

-- LIMPEZA DOS DADOS DE TESTE, antes do arranque real (decisao do dono do
-- projecto, 2026-09-14).
--
-- Os 34 pedidos em producao nao sao operacao real -- sao testes do dono do
-- projecto. Confirmado por ele explicitamente. A instrucao 19 do documento
-- mestre ("nunca apagar dados simplesmente porque parecem antigos sem verificar
-- a sua utilizacao") fica cumprida: verificou-se, e a resposta foi que sao
-- testes.
--
-- Isto corre ANTES da Fase 6 e em separado, de proposito: a base fica limpa e
-- visivel antes de se mexer em codigo financeiro, e se alguma coisa correr mal
-- os dois problemas nao se misturam.
--
-- O QUE SAI
--   34 pedidos, e por CASCADE: order_status_history (254), deliveries (10),
--      delivery_tracking (63), delivery_proofs (0), dispatch_attempts (0)
--   685 notificacoes de pedido/entrega (nao tem FK para orders, nao saem
--      sozinhas -- ficariam a apontar para pedidos que deixaram de existir)
--   4 motoristas de teste criados pelo scripts/rls-http-test.mjs
--   16 contas rlstest-*@deliveryapp.test, e por CASCADE os perfis, user_roles,
--      push_subscriptions e as 3 frotas `Frota rlstest-*` de que eram donas
--
-- O QUE FICA, por decisao expressa
--   os 2 perfis de negocio, incluindo `Alfas restourante`
--   as 3 frotas reais (Alfandega Balde, Alfa Balde x2)
--   os 3 motoristas reais, incluindo Alfa21
--   os 11 fleet_zone_prices -- sao CONFIGURACAO, nao dados de teste; apaga-los
--      obrigava a recadastrar os precos por bairro a mao
--   125 notificacoes que nao sao de pedidos (vista, chat_message, contacto)
--
-- COMO SE DISTINGUE O QUE E' TESTE: as contas de teste tem email
-- `rlstest-%@deliveryapp.test`; as contas reais de motorista usam o esquema de
-- telefone `c<numero>@deliveryapp.gw`. Nao ha sobreposicao -- medido.
--
-- SALVAGUARDA: as contagens sao verificadas ANTES de apagar seja o que for, e
-- qualquer divergencia ABORTA a transacao inteira sem tocar em nada. Se
-- entretanto aparecer um 35o pedido, esse pode ser real -- e nesse caso esta
-- migracao tem de falhar, nao de adivinhar. Mesma disciplina do DO $migration$
-- de 20260907090337.

DO $limpeza$
DECLARE
  v_pedidos          integer;
  v_entregas         integer;
  v_motoristas_teste integer;
  v_frotas_teste     integer;
  v_contas_teste     integer;
  v_motoristas_reais integer;
  v_frotas_reais     integer;
  v_apagados         integer;
BEGIN
  -- ---------------------------------------------------------------- guardas
  SELECT count(*) INTO v_pedidos  FROM public.orders;
  SELECT count(*) INTO v_entregas FROM public.deliveries;

  SELECT count(*) INTO v_motoristas_teste
  FROM public.drivers d JOIN auth.users u ON u.id = d.user_id
  WHERE u.email LIKE 'rlstest-%@deliveryapp.test';

  SELECT count(*) INTO v_frotas_teste
  FROM public.fleets WHERE name LIKE 'Frota rlstest-%';

  SELECT count(*) INTO v_contas_teste
  FROM auth.users WHERE email LIKE 'rlstest-%@deliveryapp.test';

  SELECT count(*) INTO v_motoristas_reais
  FROM public.drivers d JOIN auth.users u ON u.id = d.user_id
  WHERE u.email NOT LIKE 'rlstest-%@deliveryapp.test';

  SELECT count(*) INTO v_frotas_reais
  FROM public.fleets WHERE name NOT LIKE 'Frota rlstest-%';

  IF v_pedidos <> 34 THEN
    RAISE EXCEPTION 'ABORTADO: esperava 34 pedidos, encontrei %. Pode ter aparecido um pedido REAL -- verificar a mao antes de correr isto', v_pedidos;
  END IF;
  IF v_entregas <> 10 THEN
    RAISE EXCEPTION 'ABORTADO: esperava 10 entregas, encontrei %', v_entregas;
  END IF;
  IF v_motoristas_teste <> 4 THEN
    RAISE EXCEPTION 'ABORTADO: esperava 4 motoristas de teste, encontrei %', v_motoristas_teste;
  END IF;
  IF v_frotas_teste <> 3 THEN
    RAISE EXCEPTION 'ABORTADO: esperava 3 frotas de teste, encontrei %', v_frotas_teste;
  END IF;
  IF v_contas_teste <> 16 THEN
    RAISE EXCEPTION 'ABORTADO: esperava 16 contas rlstest, encontrei %', v_contas_teste;
  END IF;

  -- O outro lado da guarda: confirmar que o que DEVE FICAR esta' la' antes de
  -- comecar. Se estes numeros nao baterem, a base nao e' a que eu medi e nao se
  -- apaga nada.
  IF v_motoristas_reais <> 3 THEN
    RAISE EXCEPTION 'ABORTADO: esperava 3 motoristas reais para preservar, encontrei %', v_motoristas_reais;
  END IF;
  IF v_frotas_reais <> 3 THEN
    RAISE EXCEPTION 'ABORTADO: esperava 3 frotas reais para preservar, encontrei %', v_frotas_reais;
  END IF;

  RAISE NOTICE 'Guardas passaram. A apagar...';

  -- ------------------------------------------------------- 1. notificacoes
  -- Primeiro, porque nao tem chave estrangeira para `orders`: se ficassem,
  -- ficavam a apontar para pedidos inexistentes. Limita-se aos tipos ligados a
  -- pedidos e entregas; `vista`, `chat_message` e `contacto` ficam.
  DELETE FROM public.notifications
  WHERE type IN ('order', 'order_update', 'novo_pedido', 'delivery', 'nova_entrega', 'dispatch_expirado');
  GET DIAGNOSTICS v_apagados = ROW_COUNT;
  RAISE NOTICE '  notificacoes de pedido/entrega: %', v_apagados;

  -- ------------------------------------------------------------ 2. pedidos
  -- Arrasta order_status_history, deliveries, delivery_tracking,
  -- delivery_proofs e dispatch_attempts por ON DELETE CASCADE.
  DELETE FROM public.orders;
  GET DIAGNOSTICS v_apagados = ROW_COUNT;
  RAISE NOTICE '  pedidos: %', v_apagados;

  -- -------------------------------------------------- 3. motoristas de teste
  -- Explicitamente, e SO' DEPOIS dos pedidos: `deliveries.driver_id` e
  -- `delivery_proofs.driver_id` sao NO ACTION, portanto enquanto houvesse
  -- entregas a apontar para eles o Postgres recusava o DELETE -- foi
  -- exactamente o que travou a conta `alfa` na Fase 1.
  --
  -- `drivers.user_id` NAO tem chave estrangeira para auth.users, por isso estas
  -- linhas nao saem sozinhas quando as contas forem apagadas. Ficariam orfas.
  DELETE FROM public.drivers d
  USING auth.users u
  WHERE u.id = d.user_id AND u.email LIKE 'rlstest-%@deliveryapp.test';
  GET DIAGNOSTICS v_apagados = ROW_COUNT;
  RAISE NOTICE '  motoristas de teste: %', v_apagados;

  -- ----------------------------------------------------- 4. contas de teste
  -- Arrasta por CASCADE: profiles, user_roles, push_subscriptions,
  -- service_requests, notifications e `fleets` (owner_user_id) -- e' assim que
  -- as 3 frotas `Frota rlstest-*` desaparecem, sem as nomear.
  DELETE FROM auth.users WHERE email LIKE 'rlstest-%@deliveryapp.test';
  GET DIAGNOSTICS v_apagados = ROW_COUNT;
  RAISE NOTICE '  contas de teste: %', v_apagados;

  -- ------------------------------------------------------------ 5. conferir
  SELECT count(*) INTO v_pedidos FROM public.orders;
  SELECT count(*) INTO v_motoristas_reais
  FROM public.drivers d JOIN auth.users u ON u.id = d.user_id;
  SELECT count(*) INTO v_frotas_reais FROM public.fleets;

  IF v_pedidos <> 0 THEN
    RAISE EXCEPTION 'ABORTADO: sobraram % pedidos', v_pedidos;
  END IF;
  IF v_motoristas_reais <> 3 THEN
    RAISE EXCEPTION 'ABORTADO: deviam sobrar 3 motoristas reais, sobraram %', v_motoristas_reais;
  END IF;
  IF v_frotas_reais <> 3 THEN
    RAISE EXCEPTION 'ABORTADO: deviam sobrar 3 frotas reais, sobraram %', v_frotas_reais;
  END IF;

  RAISE NOTICE 'Limpeza concluida: 0 pedidos, 3 motoristas reais, 3 frotas reais.';
END
$limpeza$;
