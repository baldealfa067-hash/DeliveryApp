-- FASE 2.4 (correccao) -- a comissao da frota volta ao pedido manual COM entrega.
--
-- DECISAO DO DONO DO PROJECTO (2026-09-16), a fechar a questao que a migracao
-- 20260916065603 deixou em aberto:
--
--   * comissao do RESTAURANTE (§25): isenta SEMPRE num pedido manual. O
--     restaurante nao usou a plataforma para conseguir este cliente -- ele
--     ligou, ou entrou pela porta.
--   * comissao da FROTA (§26): aplica-se quando o pedido manual usa ENTREGA. Ai
--     o motorista fez trabalho real atraves do despacho da plataforma, e essa
--     parte gera comissao como qualquer outra entrega despachada.
--
-- A distincao e sobre QUEM usou a plataforma para QUE. O restaurante nao a usou
-- para vender; a frota usou-a para entregar. Sao duas perguntas diferentes e
-- tinham a mesma resposta por engano meu.
--
-- MECANICAMENTE isto e TIRAR a guarda que eu tinha posto no bloco da frota, e
-- nao acrescentar condicao nova: a condicao "so ha comissao de frota quando ha
-- entrega" JA existia, e e' `v_fleet_id IS NOT NULL AND v_delivery_fee > 0` --
-- um pedido sem entrega nao tem frota nem taxa, portanto nunca chega la. O que
-- eu tinha acrescentado a mais era o `AND v_source <> 'manual'`, que desligava
-- tambem os casos em que havia mesmo entrega. Sai esse, fica a condicao
-- original. O bloco do restaurante mantem a sua.
--
-- Fica UMA guarda de pedido manual na funcao, nao duas -- e a assercao no fim
-- exige exactamente isso, para esta correccao nao poder passar por engano sem
-- ter feito nada.
DO $do$
DECLARE
  v_def   text;
  v_novo  text;
  v_quant integer;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'ledger_registar_conclusao';
  IF v_def IS NULL THEN RAISE EXCEPTION 'ledger_registar_conclusao nao encontrada'; END IF;

  v_novo := replace(v_def,
    '  -- FASE 2.4: idem, a letra da decisao 5. Ver CLAUDE.md.' || chr(10) ||
    '  IF v_fleet_id IS NOT NULL AND v_delivery_fee > 0 AND v_source <> ''manual'' THEN',
    '  -- FASE 2.4 (corrigido 2026-09-16): a frota PAGA comissao tambem no pedido' || chr(10) ||
    '  -- manual, quando ha entrega. O motorista fez trabalho real pelo despacho' || chr(10) ||
    '  -- da plataforma (§26). Quem fica isento e so o restaurante (§25), acima.' || chr(10) ||
    '  IF v_fleet_id IS NOT NULL AND v_delivery_fee > 0 THEN');

  IF v_novo = v_def THEN
    RAISE EXCEPTION 'nao encontrei a guarda de manual no bloco da comissao da frota';
  END IF;

  EXECUTE v_novo;

  -- Verificar o que ficou instalado, nao o que eu quis instalar.
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'ledger_registar_conclusao';

  v_quant := (length(v_def) - length(replace(v_def, 'v_source <> ''manual''', '')))
             / length('v_source <> ''manual''');
  IF v_quant <> 1 THEN
    RAISE EXCEPTION 'esperava 1 guarda de pedido manual (so a do restaurante), encontrei %', v_quant;
  END IF;

  -- A guarda que sobra tem de ser a do RESTAURANTE.
  IF v_def NOT LIKE '%IF v_total > 0 AND v_source <> ''manual'' THEN%' THEN
    RAISE EXCEPTION 'a guarda que sobrou nao e a do bloco da comissao do restaurante';
  END IF;
  -- E a da frota tem de ter voltado a condicao original.
  IF v_def NOT LIKE '%IF v_fleet_id IS NOT NULL AND v_delivery_fee > 0 THEN%' THEN
    RAISE EXCEPTION 'o bloco da frota nao ficou com a condicao original';
  END IF;
  -- §28 continua intacto, que e o que nunca pode desaparecer.
  IF v_def NOT LIKE '%divida_comida%' OR v_def NOT LIKE '%credito_comida%' THEN
    RAISE EXCEPTION 'a divida de comida desapareceu da funcao';
  END IF;
END
$do$;
