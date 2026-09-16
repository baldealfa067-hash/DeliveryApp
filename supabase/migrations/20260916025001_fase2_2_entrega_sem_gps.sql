-- DECISAO DO DONO DO PROJECTO (2026-09-16): um pedido de entrega SEM
-- coordenadas e' aceite e despachado na mesma. A distancia fica por calcular.
--
-- PORQUE: a indicacao de voz e' o mecanismo real de navegacao nesta plataforma
-- (§21) -- "estou perto da escola, depois da farmacia, liga quando chegares".
-- O GPS e' um extra para distancia e analise futura (§40), nunca um requisito
-- para a entrega poder existir. Exigi-lo deixava sem opcao de entrega qualquer
-- cliente que legitimamente nao desse permissao de localizacao, o que acontece
-- na pratica.
--
-- O QUE ESTAVA: `update_order_status` so' criava a linha de `deliveries` dentro
-- de um `IF <coordenadas dos dois lados> THEN`. Sem elas caia no ELSE, escrevia
-- uma nota e deixava o pedido parado em `pronto` -- sem entrega, invisivel a
-- todas as frotas, e invisivel tambem ao `expire_stale_dispatch`, que faz JOIN
-- a `deliveries`. Era o "pedido preso" da Fase 2.2.
--
-- DISTANCIA A NULL, NUNCA A ZERO. §40: "se a medicao GPS ainda nao for
-- suficientemente confiavel, nao apresentar valores estimados como se fossem
-- precisos". NULL diz "nao se sabe"; 0 seria uma mentira que entrava depois nas
-- metricas de quilometragem da frota como se fosse uma entrega de porta com
-- porta. A coluna `deliveries.distance_km` ja' e' nullable -- confirmado antes
-- de mexer, nao assumido.
--
-- CUIDADO COM O CALCULO: nao bastava tirar a guarda e deixar a formula correr
-- com NULLs. `GREATEST(-1.0, NULL)` em Postgres IGNORA o NULL e devolve -1.0,
-- portanto `acos(-1.0)` = pi e a "distancia" saia 20.015 km -- um valor
-- inventado, com ar de verdadeiro. Por isso a guarda mantem-se, mas passa a
-- decidir apenas se ha DISTANCIA, nao se ha ENTREGA.
--
-- COMO E' APLICADO: por recorte da definicao VIVA (`pg_get_functiondef`),
-- ancorado em duas marcas curtas e unicas, em vez de reescrever as ~250 linhas
-- do `update_order_status` a partir do ficheiro. A razao esta na migracao
-- 20260916014049 desta mesma fase: o ficheiro de migracao tinha divergido da
-- base e uma reescrita "fiel ao ficheiro" partiu a funcao inteira. Cada passo
-- aqui e' verificado e ABORTA em vez de passar em silencio.

DO $do$
DECLARE
  v_def       text;
  v_novo      text;
  v_ini       integer;
  v_marca_fim text := ' [Entrega automatica nao criada: coordenadas em falta]'';';
  v_fim       integer;
  v_endif     integer;
  v_bloco     text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'update_order_status';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'update_order_status nao encontrada';
  END IF;

  -- Ancora de inicio: a guarda das coordenadas.
  v_ini := position('IF v_restaurant_lat IS NOT NULL' in v_def);
  IF v_ini = 0 THEN
    RAISE EXCEPTION 'Nao encontrei a guarda de coordenadas -- definicao viva inesperada';
  END IF;

  -- Ancora de fim: a nota do ramo ELSE, e o END IF; que a fecha.
  v_fim := position(v_marca_fim in v_def);
  IF v_fim = 0 THEN
    RAISE EXCEPTION 'Nao encontrei o ramo ELSE das coordenadas -- ja aplicado, ou definicao inesperada';
  END IF;
  v_fim := v_fim + length(v_marca_fim);

  v_endif := position('END IF;' in substring(v_def from v_fim));
  IF v_endif = 0 THEN
    RAISE EXCEPTION 'Nao encontrei o END IF; da guarda de coordenadas';
  END IF;
  v_endif := v_fim + v_endif - 1 + length('END IF;');

  v_bloco :=
'IF v_restaurant_lat IS NOT NULL AND v_restaurant_lng IS NOT NULL
         AND v_customer_lat IS NOT NULL AND v_customer_lng IS NOT NULL THEN

        -- Dado analitico (§40). Nao entra no preco (§15).
        v_distance_km := 6371 * acos(
          LEAST(1.0, GREATEST(-1.0,
            cos(radians(v_restaurant_lat)) * cos(radians(v_customer_lat)) *
            cos(radians(v_customer_lng) - radians(v_restaurant_lng)) +
            sin(radians(v_restaurant_lat)) * sin(radians(v_customer_lat))
          ))
        );
      ELSE
        -- Sem coordenadas dos dois lados NAO ha distancia. NULL, nunca 0 (§40):
        -- a formula acima com NULLs devolveria 20.015 km, porque o GREATEST
        -- ignora NULLs. A entrega cria-se na mesma -- §21, a voz e que guia.
        v_distance_km := NULL;
      END IF;

      -- A ENTREGA EXISTE COM OU SEM GPS (decisao de 2026-09-16).
      INSERT INTO public.deliveries (
        order_id, restaurant_lat, restaurant_lng, restaurant_address,
        customer_lat, customer_lng, customer_address, distance_km, status,
        fleet_id, delivery_fee
      ) VALUES (
        p_order_id, v_restaurant_lat, v_restaurant_lng, v_restaurant_address,
        v_customer_lat, v_customer_lng, COALESCE(v_customer_address, ''''),
        CASE WHEN v_distance_km IS NULL THEN NULL
             ELSE round(v_distance_km::numeric, 2) END,
        ''pendente'', v_fleet_id, v_delivery_fee
      ) RETURNING id INTO v_delivery_id;

      -- §34: a oferta vai para os motoristas DESTA frota, e mais ninguem.
      v_notificados := public.offer_delivery_to_fleet(v_delivery_id, 1);

      IF v_fleet_id IS NULL THEN
        p_note := COALESCE(p_note, '''') || '' [Entrega sem frota atribuida: bairro sem preco definido]'';
      ELSIF v_notificados = 0 THEN
        p_note := COALESCE(p_note, '''') || '' [Sem motorista disponivel na frota]'';
      END IF;

      IF v_distance_km IS NULL THEN
        p_note := COALESCE(p_note, '''') || '' [Sem coordenadas: distancia nao calculada]'';
      END IF;

      INSERT INTO public.order_status_history (order_id, status, note, created_by)
      VALUES (p_order_id, ''pronto'', p_note, auth.uid());

      v_final_status := ''aguardando_motorista'';';

  v_novo := substring(v_def from 1 for v_ini - 1) || v_bloco || substring(v_def from v_endif);

  EXECUTE v_novo;

  -- Verificacao do que ficou MESMO instalado, nao do que eu quis instalar.
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'update_order_status';

  IF v_def LIKE '%Entrega automatica nao criada%' THEN
    RAISE EXCEPTION 'O ramo que recusava a entrega sobreviveu';
  END IF;
  IF v_def NOT LIKE '%CASE WHEN v_distance_km IS NULL%' THEN
    RAISE EXCEPTION 'A distancia null-safe nao entrou';
  END IF;
  IF v_def NOT LIKE '%offer_delivery_to_fleet%' THEN
    RAISE EXCEPTION 'A oferta a frota desapareceu';
  END IF;
  IF v_def NOT LIKE '%v_allowed%' THEN
    RAISE EXCEPTION 'A matriz de transicoes desapareceu';
  END IF;
  IF v_def LIKE '%INSERT INTO public.notifications%' THEN
    RAISE EXCEPTION 'Voltou a haver notificacao directa (regressao da Fase 2.2)';
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- `create_delivery`: caminho legado, e um furo de isolamento
-- ---------------------------------------------------------------------------
--
-- Foi verificada a utilizacao antes de lhe tocar (regra do documento mestre,
-- §19): o hook `useCreateDelivery` existe em `src/hooks/useDrivers.ts` mas NAO
-- e' chamado em lado nenhum do frontend. A RPC esta' orfa.
--
-- E nao e' inofensiva. Comparada com o caminho vivo, esta:
--   * notifica TODOS os motoristas disponiveis de TODAS as frotas
--     (`WHERE d.is_available = true`), sem filtrar por `fleet_id` -- e' o §46 ao
--     contrario: a Frota B fica a saber das entregas da Frota A
--   * nao preenche `fleet_id` nem `delivery_fee`, portanto a entrega nasce sem
--     frota e a comissao da Fase 6 nao tem de quem
--   * nao regista `dispatch_attempts`, logo a expiracao nunca lhe toca
--   * escreve `orders.status` directamente, saltando a matriz de transicoes
--     imposta na Fase 1 (§36)
--
-- NAO SE APAGA A FUNCAO -- so' se lhe tira o EXECUTE. Apagar era irreversivel e
-- o documento manda nao apagar sem necessidade; revogar e' uma linha e
-- reverte-se com outra. Se alguem precisar mesmo de criar entregas a mao, o
-- caminho certo e' uma RPC nova que respeite a frota.
REVOKE EXECUTE ON FUNCTION public.create_delivery(
  uuid, double precision, double precision, text,
  double precision, double precision, text, double precision
) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.create_delivery(
  uuid, double precision, double precision, text,
  double precision, double precision, text, double precision
) IS
  'LEGADO, SEM EXECUTE (Fase 2.2). Nao respeita a frota: notificava todos os '
  'motoristas de todas as frotas e nao preenchia fleet_id/delivery_fee. '
  'Substituida pelo caminho de update_order_status + offer_delivery_to_fleet. '
  'Mantida apenas para nao apagar historico de esquema.';
