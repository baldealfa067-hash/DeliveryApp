-- FASE 2.4 -- pedidos manuais: a origem do pedido, e a isencao de comissao.
--
-- O PROBLEMA: um restaurante recebe pedidos por telefone e ao balcao. Se esses
-- nao entrarem no sistema, o stock que o painel mostra esta errado (a comida
-- saiu e ninguem descontou) e as vendas tambem. §71 quer uma fonte de verdade
-- unica; ter metade da operacao fora dela nao e uma fonte de verdade.
--
-- DECISOES DO DONO DO PROJECTO (2026-09-16), registadas no CLAUDE.md:
--   1. mesma tabela `orders`, marcada com `source = 'manual'`
--   2. pode pedir entrega, e opcional
--   3. o stock desconta na CRIACAO, nao na confirmacao
--   4. a reposicao de stock e manual, nao reinicia com o dia
--   5. pedido manual NAO gera comissao da plataforma
--
-- ---------------------------------------------------------------------------
-- 1. A origem
-- ---------------------------------------------------------------------------
-- DEFAULT 'app' e NOT NULL: todos os pedidos existentes foram feitos pela
-- aplicacao, e uma coluna que possa ser NULL obrigava cada leitor a decidir o
-- que fazer com o desconhecido -- e mais cedo ou mais tarde um deles decidia
-- mal e isentava de comissao um pedido normal.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'app';

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_source_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_source_check
  CHECK (source IN ('app', 'manual'));

CREATE INDEX IF NOT EXISTS orders_source ON public.orders (business_id, source);

COMMENT ON COLUMN public.orders.source IS
  'Por onde entrou o pedido. `app` = o cliente fez o pedido na aplicacao; '
  '`manual` = o restaurante lancou-o a mao (telefone, balcao). Decide a '
  'isencao de comissao (Fase 2.4, decisao 5) -- ver ledger_registar_conclusao.';

-- O cliente nao escolhe a origem do seu proprio pedido: se `source` fosse
-- escrivel, qualquer um marcava o pedido como manual e fugia a comissao. So as
-- RPCs SECURITY DEFINER escrevem esta coluna.
--
-- NOTA: o RLS ja bloqueava a escrita directa (a unica policy de UPDATE em
-- `orders` e a do admin), portanto isto e reforco, no mesmo espirito do REVOKE
-- que a Fase 2.1 fez a `menu_items.stock_qty`. Medido antes: nenhum sitio do
-- frontend faz UPDATE directo a `orders` -- as escritas passam todas por
-- `update_order_status`, que e SECURITY DEFINER e nao depende destes GRANTs.
REVOKE UPDATE ON public.orders FROM authenticated;
GRANT  UPDATE (status, updated_at, payment_proof_url, payment_status)
  ON public.orders TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Isencao de comissao
-- ---------------------------------------------------------------------------
-- A decisao 5 diz "nao gera comissao da plataforma". Aplicada a LETRA: nem a do
-- restaurante (§25) nem a da frota (§26). Fica sinalizado no CLAUDE.md que o
-- caso da frota pode nao ter sido a intencao -- se um pedido manual pedir
-- entrega, a frota usa o dispatch da plataforma na mesma. Mudar isso e tirar
-- `AND v_source <> 'manual'` do bloco 2, uma linha.
--
-- O QUE **NAO** MUDA, e e o ponto mais importante desta migracao: a divida de
-- comida da frota ao restaurante (§28) CONTINUA a ser registada num pedido
-- manual pago a dinheiro. Isso nao e comissao -- e dinheiro de terceiros que
-- passou pela mao do motorista. Isentar isso era fazer desaparecer dinheiro do
-- restaurante do sistema, que e exactamente o buraco que a Fase 2.3 fechou.
-- Os blocos 3 e 4 ficam intactos de proposito.
--
-- Editado sobre a definicao VIVA, com assercao por cada passo (licao de
-- 20260916014049: o ficheiro de migracao nao e a verdade, a base e que e).
DO $do$
DECLARE
  v_def  text;
  v_novo text;
  v_ok   boolean;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'ledger_registar_conclusao';
  IF v_def IS NULL THEN RAISE EXCEPTION 'ledger_registar_conclusao nao encontrada'; END IF;

  -- (a) variavel nova
  v_novo := replace(v_def, '  v_tem_viva     boolean;', '  v_tem_viva     boolean;' || chr(10) || '  v_source       text;');
  IF v_novo = v_def THEN RAISE EXCEPTION 'nao encontrei a declaracao de v_tem_viva'; END IF;
  v_def := v_novo;

  -- (b) ler a origem junto com o resto
  v_novo := replace(v_def,
    'COALESCE(o.payment_method,''entrega'')' || chr(10) ||
    '  INTO v_business_id, v_total, v_fleet_id, v_delivery_fee, v_payment',
    'COALESCE(o.payment_method,''entrega''), COALESCE(o.source,''app'')' || chr(10) ||
    '  INTO v_business_id, v_total, v_fleet_id, v_delivery_fee, v_payment, v_source');
  IF v_novo = v_def THEN RAISE EXCEPTION 'nao encontrei o SELECT ... INTO do pedido'; END IF;
  v_def := v_novo;

  -- (c) bloco 1: comissao do restaurante
  v_novo := replace(v_def,
    '  IF v_total > 0 THEN',
    '  -- FASE 2.4: pedido manual nao gera comissao (decisao 5).' || chr(10) ||
    '  IF v_total > 0 AND v_source <> ''manual'' THEN');
  IF v_novo = v_def THEN RAISE EXCEPTION 'nao encontrei o bloco da comissao do restaurante'; END IF;
  v_def := v_novo;

  -- (d) bloco 2: comissao da frota
  v_novo := replace(v_def,
    '  IF v_fleet_id IS NOT NULL AND v_delivery_fee > 0 THEN',
    '  -- FASE 2.4: idem, a letra da decisao 5. Ver CLAUDE.md.' || chr(10) ||
    '  IF v_fleet_id IS NOT NULL AND v_delivery_fee > 0 AND v_source <> ''manual'' THEN');
  IF v_novo = v_def THEN RAISE EXCEPTION 'nao encontrei o bloco da comissao da frota'; END IF;
  v_def := v_novo;

  EXECUTE v_def;

  -- Confirmar o que ficou instalado, nao o que eu quis instalar.
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'ledger_registar_conclusao';

  v_ok := v_def LIKE '%v_source <> ''manual''%'
      AND v_def LIKE '%divida_comida%'      -- §28 tem de sobreviver
      AND v_def LIKE '%credito_comida%'
      AND v_def LIKE '%divida_entrega%'
      AND v_def LIKE '%comissao_restaurante%';
  IF NOT v_ok THEN
    RAISE EXCEPTION 'a funcao instalada nao tem a forma esperada -- inspeccionar a mao';
  END IF;

  -- Duas isencoes, nao uma: restaurante e frota.
  IF (length(v_def) - length(replace(v_def, 'v_source <> ''manual''', ''))) / length('v_source <> ''manual''') <> 2 THEN
    RAISE EXCEPTION 'esperava 2 guardas de pedido manual, encontrei outra coisa';
  END IF;
END
$do$;
