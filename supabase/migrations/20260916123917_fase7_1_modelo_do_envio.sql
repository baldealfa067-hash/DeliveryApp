-- FASE 7.1 -- o modelo do envio (§19). Esquema apenas; a criacao chega na 7.2.
--
-- `business_id` deixa de ser obrigatorio SEM deixar de ser garantido onde
-- importa. A coluna `kind` diz o que o pedido e', e um CHECK amarra as duas
-- coisas uma a outra: nao existe pedido de restaurante sem restaurante, nem
-- envio com restaurante. Tornar a coluna nullable e ficar por ai deixava a
-- porta aberta a um pedido de comida sem dono, que e' pior do que o problema
-- que se veio resolver.

-- ---------------------------------------------------------------------------
-- 1. A coluna que diz o que isto e'
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'restaurante';

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_kind_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_kind_check
  CHECK (kind IN ('restaurante', 'envio'));

COMMENT ON COLUMN public.orders.kind IS
  'O que este pedido e (Fase 7.1). `restaurante` = comida, tem business_id. '
  '`envio` = documento/objecto (§19), sem restaurante nenhum. A coerencia '
  'entre kind, business_id, consumption_option e total e imposta pelo CHECK '
  'orders_kind_coerente -- nao por disciplina de quem escreve.';

-- ---------------------------------------------------------------------------
-- 2. Onde se vai buscar (§19: Origem -> Destino)
-- ---------------------------------------------------------------------------
-- O DESTINO ja tem colunas: `address`, `bairro`, `customer_lat/lng`,
-- `voice_note_url`. Faltava a ORIGEM, que num pedido de restaurante e' o
-- restaurante e por isso nunca precisou de existir.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS pickup_address        text,
  ADD COLUMN IF NOT EXISTS pickup_bairro         text,
  ADD COLUMN IF NOT EXISTS pickup_voice_note_url text,
  ADD COLUMN IF NOT EXISTS send_item_type        text;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_send_item_type_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_send_item_type_check
  CHECK (send_item_type IS NULL OR send_item_type IN ('documento', 'objeto', 'outro'));

-- A SEGUNDA GRAVACAO DE VOZ e' a peca mais importante desta migracao, e a menos
-- obvia. Numa entrega de restaurante a origem e' conhecida e tem morada; num
-- envio a origem e' o sitio MAIS dificil de explicar -- "a casa a seguir a
-- bomba, pergunta pelo Sr. Mane". §21 diz que a voz e' a ferramenta central e
-- §78 que uma referencia local vale mais que um numero de porta. Uma so
-- gravacao obrigava o cliente a descrever os dois sitios seguidos, e o
-- motorista a ouvir tudo outra vez a meio do caminho.
COMMENT ON COLUMN public.orders.pickup_voice_note_url IS
  'Indicacao de voz da RECOLHA (§21). Separada de `voice_note_url`, que e a da '
  'entrega: sao dois sitios diferentes e o motorista precisa de as ouvir em '
  'momentos diferentes.';

COMMENT ON COLUMN public.orders.pickup_bairro IS
  'Bairro de ORIGEM. Guardado para analise e para uma evolucao futura do preco '
  '(§16); NAO entra no preco hoje -- o preco sai do bairro de DESTINO, como em '
  'qualquer entrega (§13, §15).';

-- ---------------------------------------------------------------------------
-- 3. `business_id` deixa de ser obrigatorio -- com coerencia imposta
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders ALTER COLUMN business_id DROP NOT NULL;

-- PORQUE O `total = 0` ESTA NESTE CHECK, e nao e' zelo a mais: o
-- `ledger_registar_conclusao` decide o que escrever a partir de `v_total > 0`.
-- Com total = 0 salta sozinho a comissao do restaurante (§25) e a divida de
-- comida (§28) -- que e' exactamente o correcto para um envio, onde nao ha
-- mercadoria nem restaurante a quem dever. Sobra a comissao da frota (§26).
--   Se um envio pudesse ter total > 0, o ledger tentava escrever uma linha
-- `comissao_restaurante` com `account_kind='business'` e `business_id` NULL, e
-- ia bater no CHECK `ledger_entries_conta_coerente` -- a entrega rebentava na
-- conclusao, depois de o motorista ja ter feito o trabalho. Fechar aqui torna
-- essa seguranca ESTRUTURAL em vez de acidental.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_kind_coerente;
ALTER TABLE public.orders ADD CONSTRAINT orders_kind_coerente
  CHECK (
    (kind = 'restaurante' AND business_id IS NOT NULL)
    OR
    (kind = 'envio'
       AND business_id IS NULL
       AND consumption_option = 'entrega'   -- um envio e' sempre uma entrega
       AND total = 0)                       -- nao ha mercadoria: o preco e a taxa
  );

-- Numeracao: o indice existente e' (business_id, order_number) e em Postgres os
-- NULL sao distintos entre si, portanto nao garantia nada para envios. O
-- DEFAULT da coluna (`nextval`) ja da valores unicos; este indice torna isso
-- uma garantia em vez de uma expectativa.
CREATE UNIQUE INDEX IF NOT EXISTS orders_numero_unico_envio
  ON public.orders (order_number) WHERE business_id IS NULL;

CREATE INDEX IF NOT EXISTS orders_kind ON public.orders (kind, status);

-- ---------------------------------------------------------------------------
-- 4. Quem cancela um envio, e ate quando
-- ---------------------------------------------------------------------------
-- O BURACO QUE ISTO TAPA: a regra da Fase 1 diz que o cliente so cancela em
-- `novo`, porque `novo` e' o estado anterior a o restaurante confirmar. Um
-- envio nao tem restaurante nem estado `novo` util -- nasce (na 7.2) ja em
-- `aguardando_motorista`. Sem esta alteracao o cliente NUNCA conseguiria
-- cancelar um envio, em estado nenhum.
--
-- O momento equivalente ao "restaurante confirmou" e' "um motorista aceitou":
-- ate la ninguem se comprometeu e o cliente pode desistir; a partir dai ha
-- alguem a caminho da recolha e a desistencia deixa de ser unilateral. E' a
-- mesma ideia da regra original, aplicada a quem faz o compromisso neste fluxo.
--
-- NAO se acrescenta transicao nova a matriz. `novo -> aguardando_motorista`
-- parecia necessaria e nao e': a 7.2 insere o envio ja em
-- `aguardando_motorista`, e um estado INICIAL nao passa pela matriz (que so
-- governa UPDATEs) -- tal como o `create_manual_order` nasce em `confirmado`.
-- Alargar a matriz para um caminho que ninguem percorre so' enfraquecia o §36.
DO $do$
DECLARE
  v_def  text;
  v_novo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='update_order_status';
  IF v_def IS NULL THEN RAISE EXCEPTION 'update_order_status nao encontrada'; END IF;

  v_novo := replace(v_def, '  v_notificados integer;',
                           '  v_notificados integer;' || chr(10) || '  v_kind text;');
  IF v_novo = v_def THEN RAISE EXCEPTION 'nao encontrei a declaracao de v_notificados'; END IF;
  v_def := v_novo;

  -- Ancoras MEDIDAS antes (1 ocorrencia cada), nao adivinhadas: a primeira
  -- tentativa desta migracao falhou por eu ter contado mal os espacos.
  v_novo := replace(v_def,
    'address, status, fleet_id, delivery_fee',
    'address, status, fleet_id, delivery_fee, COALESCE(kind, ''restaurante'')');
  IF v_novo = v_def THEN RAISE EXCEPTION 'nao encontrei a lista do SELECT'; END IF;
  v_def := v_novo;

  v_novo := replace(v_def,
    'v_fleet_id, v_delivery_fee' || chr(10) || '  FROM public.orders WHERE id = p_order_id;',
    'v_fleet_id, v_delivery_fee, v_kind' || chr(10) || '  FROM public.orders WHERE id = p_order_id;');
  IF v_novo = v_def THEN RAISE EXCEPTION 'nao encontrei a lista do INTO'; END IF;
  v_def := v_novo;

  v_novo := replace(v_def,
    '      IF NOT (p_new_status = ''cancelado'' AND v_current_status = ''novo'') THEN' || chr(10) ||
    '        RAISE EXCEPTION ''O cliente so pode cancelar um pedido ainda por confirmar'';' || chr(10) ||
    '      END IF;',
    '      IF v_kind = ''envio'' THEN' || chr(10) ||
    '        -- FASE 7.1: num envio nao ha restaurante que confirme. O momento' || chr(10) ||
    '        -- equivalente e um motorista aceitar -- ate la o cliente desiste.' || chr(10) ||
    '        IF NOT (p_new_status = ''cancelado''' || chr(10) ||
    '                AND v_current_status IN (''novo'', ''aguardando_motorista'')) THEN' || chr(10) ||
    '          RAISE EXCEPTION ''So pode cancelar um envio enquanto nenhum motorista o aceitou'';' || chr(10) ||
    '        END IF;' || chr(10) ||
    '      ELSIF NOT (p_new_status = ''cancelado'' AND v_current_status = ''novo'') THEN' || chr(10) ||
    '        RAISE EXCEPTION ''O cliente so pode cancelar um pedido ainda por confirmar'';' || chr(10) ||
    '      END IF;');
  IF v_novo = v_def THEN RAISE EXCEPTION 'nao encontrei a regra de cancelamento do cliente'; END IF;

  EXECUTE v_novo;

  -- Verificar o que ficou instalado. NOTA: `is_business_open` NAO pertence a
  -- esta funcao -- o travao de horario da Fase 2.5 foi para o `create_order`.
  -- Uma tentativa anterior afirmava o contrario e abortou a migracao inteira.
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='update_order_status';

  IF v_def NOT LIKE '%So pode cancelar um envio enquanto nenhum motorista o aceitou%' THEN
    RAISE EXCEPTION 'a regra do envio nao entrou';
  END IF;
  IF v_def NOT LIKE '%O cliente so pode cancelar um pedido ainda por confirmar%' THEN
    RAISE EXCEPTION 'a regra original do restaurante desapareceu';
  END IF;
  IF v_def NOT LIKE '%v_allowed%' OR v_def NOT LIKE '%Transicao invalida%' THEN
    RAISE EXCEPTION 'perdeu a matriz de transicoes (§36)';
  END IF;
  IF v_def NOT LIKE '%offer_delivery_to_fleet%' THEN
    RAISE EXCEPTION 'perdeu a oferta a frota';
  END IF;
  IF v_def NOT LIKE '%CASE WHEN v_distance_km IS NULL%' THEN
    RAISE EXCEPTION 'regressao da entrega sem GPS';
  END IF;
  IF v_def NOT LIKE '%O motorista so pode recolher, seguir e concluir a entrega%' THEN
    RAISE EXCEPTION 'perdeu a regra do motorista';
  END IF;
END
$do$;
