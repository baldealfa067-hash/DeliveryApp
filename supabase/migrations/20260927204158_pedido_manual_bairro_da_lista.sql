-- Pedido manual com entrega: o bairro e ESCOLHIDO, nunca escrito a mao
-- (decisao do dono, 2026-09-27).
--
-- Porque: o ecra tinha um campo de texto livre. O pedido manual #12 foi gravado
-- com "cupilum" em vez de "Cupelum"; get_delivery_price() nao encontrou frota,
-- o pedido ficou sem frota e sem taxa, e parou em `aguardando_motorista` sem
-- ninguem a quem o oferecer.
--
-- O ecra passa a ser uma lista (a mesma do checkout). Aqui fecha-se o mesmo
-- caminho no servidor (§46): com entrega, o bairro e obrigatorio e tem de ter
-- uma frota que o sirva -- a MESMA resolucao do create_order, get_delivery_price(),
-- sem logica paralela. A unica diferenca e recusar em vez de gravar um pedido
-- que ninguem vai entregar (o mesmo criterio do create_send_order, Fase 7).
--
-- Transformacao cirurgica sobre a definicao VIVA, nao sobre o ficheiro da
-- Fase 2.4: as duas ja divergiram antes (ver debugging-patterns). Se o trecho
-- nao for encontrado, aborta em vez de gravar uma funcao a meio.

DO $migracao$
DECLARE
  v_def  text := pg_get_functiondef('public.create_manual_order(uuid, jsonb, text, text, text, text, text, text, text, boolean)'::regprocedure);
  v_novo text;
  v_old  text := $old$  IF p_consumption_option = 'entrega' AND p_bairro IS NOT NULL THEN
    SELECT gp.fleet_id, gp.preco INTO v_fleet_id, v_delivery_fee
    FROM public.get_delivery_price(p_bairro) gp;
  END IF;$old$;
  v_new  text := $new$  IF p_consumption_option = 'entrega' THEN
    -- 2026-09-27: o bairro vem de uma lista e tem de ter frota. Texto livre
    -- ("cupilum") gravava um pedido sem frota nem taxa, preso para sempre.
    IF NULLIF(btrim(COALESCE(p_bairro, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Escolha o bairro de entrega';
    END IF;
    SELECT gp.fleet_id, gp.preco INTO v_fleet_id, v_delivery_fee
    FROM public.get_delivery_price(p_bairro) gp;
    IF v_fleet_id IS NULL THEN
      RAISE EXCEPTION 'Nenhuma frota entrega em "%" de momento. Escolha outro bairro, ou lance o pedido para levar.', btrim(p_bairro);
    END IF;
  END IF;$new$;
BEGIN
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'create_manual_order: trecho da resolucao do bairro nao encontrado na definicao viva';
  END IF;
  v_novo := replace(v_def, v_old, v_new);
  EXECUTE v_novo;  -- CREATE OR REPLACE: mantem os GRANTs
END
$migracao$;

-- Guardas: a funcao tem de ter ficado com o travao, e sem perder o acesso.
DO $guarda$
DECLARE v_def text := pg_get_functiondef('public.create_manual_order(uuid, jsonb, text, text, text, text, text, text, text, boolean)'::regprocedure);
BEGIN
  IF position('Escolha o bairro de entrega' IN v_def) = 0
     OR position('Nenhuma frota entrega em' IN v_def) = 0 THEN
    RAISE EXCEPTION 'create_manual_order ficou sem o travao do bairro';
  END IF;
  IF NOT has_function_privilege('authenticated',
       'public.create_manual_order(uuid, jsonb, text, text, text, text, text, text, text, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'create_manual_order perdeu o EXECUTE para authenticated';
  END IF;
  IF has_function_privilege('anon',
       'public.create_manual_order(uuid, jsonb, text, text, text, text, text, text, text, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'create_manual_order ficou executavel por anon';
  END IF;
END
$guarda$;
