-- FASE 2.4 -- a origem do pedido tem de chegar ao painel.
--
-- Sem isto o restaurante ve os pedidos manuais misturados com os da aplicacao e
-- nao os distingue -- e a diferenca importa-lhe ao bolso: uns geram comissao,
-- outros nao (decisao 5). §83, principio de nao surpresa.
--
-- A assinatura nao muda (p_business_id, p_status); muda o RETURNS TABLE, o que
-- obriga a DROP + CREATE. A coluna vai ao FIM da lista de proposito: o hook do
-- frontend le por nome (`data as Order[]`), portanto acrescentar no fim nao
-- parte nada, e mudar a ordem no meio partiria.
--
-- Editado sobre a definicao VIVA, com assercao (licao de 20260916014049).
DO $do$
DECLARE
  v_def  text;
  v_novo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_business_orders';
  IF v_def IS NULL THEN RAISE EXCEPTION 'get_business_orders nao encontrada'; END IF;

  -- (a) declarar a coluna nova no tipo de retorno
  v_novo := replace(v_def, 'created_at timestamp with time zone)',
                           'created_at timestamp with time zone, source text)');
  IF v_novo = v_def THEN RAISE EXCEPTION 'nao encontrei o fim do RETURNS TABLE'; END IF;
  v_def := v_novo;

  -- (b) devolve-la. Ancora na linha inteira do SELECT, nao em `o.created_at`
  -- sozinho -- esse aparece duas vezes (SELECT e ORDER BY) e um replace cego
  -- estragava o ORDER BY.
  v_novo := replace(v_def,
    '    o.created_at' || chr(10) || '  FROM public.orders o',
    '    o.created_at, COALESCE(o.source, ''app'')' || chr(10) || '  FROM public.orders o');
  IF v_novo = v_def THEN RAISE EXCEPTION 'nao encontrei a lista do SELECT'; END IF;
  v_def := v_novo;

  DROP FUNCTION IF EXISTS public.get_business_orders(uuid, text);
  EXECUTE v_def;

  -- Confirmar o que ficou instalado.
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_business_orders';
  IF v_def IS NULL THEN RAISE EXCEPTION 'a funcao desapareceu apos o DROP'; END IF;
  IF v_def NOT LIKE '%source text)%' THEN RAISE EXCEPTION 'a coluna source nao entrou no retorno'; END IF;
  IF v_def NOT LIKE '%ORDER BY o.created_at DESC%' THEN RAISE EXCEPTION 'o ORDER BY foi danificado'; END IF;
END
$do$;

REVOKE EXECUTE ON FUNCTION public.get_business_orders(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_business_orders(uuid, text) TO authenticated;
