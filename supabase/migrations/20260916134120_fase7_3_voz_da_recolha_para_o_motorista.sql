-- FASE 7.3 -- a voz da RECOLHA tem de chegar ao motorista.
--
-- A 7.1 criou `orders.pickup_voice_note_url` e a 7.2 passou a grava-la, mas as
-- duas funcoes que o motorista usa devolviam apenas `voice_note_url` -- a voz da
-- ENTREGA. Ou seja: a gravacao mais util de todas ficava guardada e ninguem a
-- ouvia. §21 poe a voz como ferramenta central, e num envio a origem e' o sitio
-- mais dificil de explicar; o motorista precisa dela ANTES da outra, porque e'
-- o primeiro sitio onde tem de chegar.
--
-- A coluna vai ao FIM do RETURNS TABLE nas duas: o frontend le por nome
-- (`data as Delivery[]`), portanto acrescentar no fim nao parte nada e mudar a
-- ordem no meio partiria. Mesma disciplina da Fase 2.4 com `source`.
--
-- Editado sobre a definicao VIVA, com assercao (licao de 20260916014049).
DO $do$
DECLARE
  v_def  text;
  v_novo text;
BEGIN
  -- ---------------------------------------------------------------- disponiveis
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='get_available_deliveries';
  IF v_def IS NULL THEN RAISE EXCEPTION 'get_available_deliveries nao encontrada'; END IF;

  v_novo := replace(v_def, 'voice_note_url text)', 'voice_note_url text, pickup_voice_note_url text)');
  IF v_novo = v_def THEN RAISE EXCEPTION 'disponiveis: nao encontrei o fim do RETURNS TABLE'; END IF;
  v_def := v_novo;

  v_novo := replace(v_def,
    '         o.voice_note_url' || chr(10) || '  FROM public.deliveries d',
    '         o.voice_note_url,' || chr(10) ||
    '         o.pickup_voice_note_url' || chr(10) || '  FROM public.deliveries d');
  IF v_novo = v_def THEN RAISE EXCEPTION 'disponiveis: nao encontrei a lista do SELECT'; END IF;

  DROP FUNCTION IF EXISTS public.get_available_deliveries();
  EXECUTE v_novo;
  REVOKE EXECUTE ON FUNCTION public.get_available_deliveries() FROM PUBLIC, anon;
  GRANT  EXECUTE ON FUNCTION public.get_available_deliveries() TO authenticated;

  -- ---------------------------------------------------------------- as minhas
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='get_my_deliveries';
  IF v_def IS NULL THEN RAISE EXCEPTION 'get_my_deliveries nao encontrada'; END IF;

  v_novo := replace(v_def, 'voice_note_url text)', 'voice_note_url text, pickup_voice_note_url text)');
  IF v_novo = v_def THEN RAISE EXCEPTION 'minhas: nao encontrei o fim do RETURNS TABLE'; END IF;
  v_def := v_novo;

  v_novo := replace(v_def,
    '         o.voice_note_url' || chr(10) || '  FROM public.deliveries d',
    '         o.voice_note_url,' || chr(10) ||
    '         o.pickup_voice_note_url' || chr(10) || '  FROM public.deliveries d');
  IF v_novo = v_def THEN RAISE EXCEPTION 'minhas: nao encontrei a lista do SELECT'; END IF;

  DROP FUNCTION IF EXISTS public.get_my_deliveries();
  EXECUTE v_novo;
  REVOKE EXECUTE ON FUNCTION public.get_my_deliveries() FROM PUBLIC, anon;
  GRANT  EXECUTE ON FUNCTION public.get_my_deliveries() TO authenticated;
END
$do$;

-- Verificar o que ficou instalado, incluindo que a Fase 7.0 nao regrediu.
DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('get_available_deliveries','get_my_deliveries')
  LOOP
    IF r.def NOT LIKE '%pickup_voice_note_url text)%' THEN
      RAISE EXCEPTION '%: a coluna nao entrou no retorno', r.proname;
    END IF;
    IF r.def NOT LIKE '%o.pickup_voice_note_url%' THEN
      RAISE EXCEPTION '%: a coluna nao e devolvida', r.proname;
    END IF;
    -- Fase 7.0: o join a profiles tem de continuar LEFT, senao os envios
    -- desaparecem outra vez.
    IF r.def NOT LIKE '%LEFT JOIN public.profiles%' THEN
      RAISE EXCEPTION '%: REGRESSAO da Fase 7.0 -- o join voltou a INNER', r.proname;
    END IF;
    IF r.def NOT LIKE '%Ponto de recolha%' THEN
      RAISE EXCEPTION '%: perdeu o COALESCE do nome de recolha', r.proname;
    END IF;
  END LOOP;
END
$do$;
