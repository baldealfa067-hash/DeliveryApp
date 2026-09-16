-- FASE 2.5 -- escrever o horario, e o travao no pedido.

-- ---------------------------------------------------------------------------
-- 1. Substituir o horario inteiro, de uma vez
-- ---------------------------------------------------------------------------
-- SUBSTITUI, nao acrescenta: o ecra edita a semana toda e envia-a inteira. Um
-- INSERT incremental obrigava o frontend a calcular diferencas e a apagar o que
-- saiu -- e uma falha a meio deixava metade do horario velho e metade do novo.
-- Assim, ou fica a semana nova toda, ou nao muda nada (uma transaccao).
CREATE OR REPLACE FUNCTION public.set_business_hours(
  p_business_id uuid,
  p_horario     jsonb   -- [{"weekday":1,"opens_at":"08:00","closes_at":"22:00"}, ...]
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_linha   jsonb;
  v_dia     smallint;
  v_abre    time;
  v_fecha   time;
  v_contou  integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessao'; END IF;
  IF NOT public.is_business_owner(p_business_id)
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'So o dono pode definir o horario';
  END IF;
  IF p_horario IS NULL OR jsonb_typeof(p_horario) <> 'array' THEN
    RAISE EXCEPTION 'Horario invalido';
  END IF;

  DELETE FROM public.business_hours WHERE business_id = p_business_id;

  FOR v_linha IN SELECT * FROM jsonb_array_elements(p_horario) LOOP
    v_dia := (v_linha->>'weekday')::smallint;
    IF v_dia IS NULL OR v_dia < 0 OR v_dia > 6 THEN
      RAISE EXCEPTION 'Dia da semana invalido: %', v_linha->>'weekday';
    END IF;

    v_abre  := (v_linha->>'opens_at')::time;
    v_fecha := (v_linha->>'closes_at')::time;
    IF v_abre IS NULL OR v_fecha IS NULL THEN
      RAISE EXCEPTION 'Periodo sem hora de abrir ou de fechar';
    END IF;

    -- Abrir e fechar a mesma hora nao e um periodo de 24h nem um periodo de
    -- zero: e um erro de quem escreveu, e e melhor recusar do que adivinhar.
    IF v_abre = v_fecha THEN
      RAISE EXCEPTION 'Abre e fecha a mesma hora (%) -- periodo invalido', v_abre;
    END IF;

    INSERT INTO public.business_hours (business_id, weekday, opens_at, closes_at)
    VALUES (p_business_id, v_dia, v_abre, v_fecha)
    ON CONFLICT (business_id, weekday, opens_at) DO NOTHING;

    v_contou := v_contou + 1;
  END LOOP;

  RETURN v_contou;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_business_hours(uuid, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_business_hours(uuid, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. O interruptor manual
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_accepting_orders(
  p_business_id uuid, p_aceitar boolean
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessao'; END IF;
  IF NOT public.is_business_owner(p_business_id)
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'So o dono pode abrir ou fechar a loja';
  END IF;

  UPDATE public.profiles SET accepting_orders = COALESCE(p_aceitar, true)
  WHERE id = p_business_id;

  RETURN COALESCE(p_aceitar, true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_accepting_orders(uuid, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_accepting_orders(uuid, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Ler o horario de uma loja (publico, e a montra)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_business_hours(p_business_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'business_id', p_business_id,
    'aberto_agora', public.is_business_open(p_business_id),
    'aceita_pedidos', COALESCE((SELECT p.accepting_orders FROM public.profiles p WHERE p.id = p_business_id), true),
    'periodos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'weekday', h.weekday,
        'opens_at', to_char(h.opens_at, 'HH24:MI'),
        'closes_at', to_char(h.closes_at, 'HH24:MI')
      ) ORDER BY h.weekday, h.opens_at)
      FROM public.business_hours h WHERE h.business_id = p_business_id
    ), '[]'::jsonb)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.get_business_hours(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_business_hours(uuid) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. O travao: nao se faz pedido a uma loja fechada
-- ---------------------------------------------------------------------------
-- §46 -- a regra vive no backend. Mostrar "Fechado" e aceitar o pedido a seguir
-- era mentir aos dois lados.
--
-- SO no `create_order` (caminho do cliente). O `create_manual_order` fica de
-- fora de proposito: quem o chama e o proprio restaurante, que sabe se esta
-- aberto -- travar o dono a entrada da sua propria loja nao fazia sentido
-- (decisao (d) da migracao anterior).
--
-- Inserido por recorte da definicao VIVA, logo a seguir a guarda que ja la
-- estava, com assercao (licao de 20260916014049).
DO $do$
DECLARE
  v_def  text;
  v_novo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'create_order';
  IF v_def IS NULL THEN RAISE EXCEPTION 'create_order nao encontrada'; END IF;

  v_novo := replace(v_def,
    '  PERFORM public.assert_can_order_for(p_business_id, p_customer_id);',
    '  PERFORM public.assert_can_order_for(p_business_id, p_customer_id);' || chr(10) || chr(10) ||
    '  -- FASE 2.5: loja fechada nao aceita pedidos (§46). O ecra ja o mostra,' || chr(10) ||
    '  -- mas o ecra nao e a autoridade -- so o backend e.' || chr(10) ||
    '  IF NOT public.is_business_open(p_business_id) THEN' || chr(10) ||
    '    RAISE EXCEPTION ''Este restaurante esta fechado neste momento'';' || chr(10) ||
    '  END IF;');

  IF v_novo = v_def THEN
    RAISE EXCEPTION 'nao encontrei o assert_can_order_for em create_order';
  END IF;

  EXECUTE v_novo;

  -- Confirmar o que ficou instalado.
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'create_order';
  IF v_def NOT LIKE '%is_business_open%' THEN
    RAISE EXCEPTION 'o travao nao entrou no create_order';
  END IF;
  -- O resto da funcao tem de continuar inteiro.
  IF v_def NOT LIKE '%business_order_counters%' OR v_def NOT LIKE '%stock_qty >= v_qty%' THEN
    RAISE EXCEPTION 'create_order perdeu o contador ou o desconto de stock';
  END IF;
END
$do$;

-- O pedido manual NAO leva travao. Fica afirmado aqui para nao parecer
-- esquecimento a quem ler as duas funcoes lado a lado.
COMMENT ON FUNCTION public.create_manual_order(uuid, jsonb, text, text, text, text, text, text, text, boolean) IS
  'Fase 2.4: pedido lancado a mao pelo restaurante (telefone, balcao). Mesma '
  'tabela `orders`, marcado source=manual: isenta a comissao do restaurante '
  '(§25) mas NAO a da frota quando ha entrega (§26), nem a divida de comida '
  '(§28). Stock desconta aqui, na criacao. Total somado do menu. '
  'NAO e travado pelo horario (Fase 2.5): quem lanca e o dono, que sabe se '
  'esta aberto.';
