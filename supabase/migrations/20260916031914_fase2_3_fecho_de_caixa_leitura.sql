-- FASE 2.3 -- o ecra do fecho de caixa, e a correccao dos leitores da Fase 6.

-- ---------------------------------------------------------------------------
-- 1. O fecho do dia, do lado da FROTA
-- ---------------------------------------------------------------------------
-- Uma linha por restaurante: quanto se recolheu hoje em dinheiro, quanto se
-- deve ao todo, e o que ja esta declarado por confirmar. §83 -- a frota tem de
-- saber o que deve e porque, sem ter de somar nada a mao.
--
-- Os motoristas vem a parte, por §32/§39: o dono da frota precisa de saber quem
-- anda com o dinheiro na mao, que e uma pergunta diferente de quanto se deve a
-- cada restaurante.
CREATE OR REPLACE FUNCTION public.get_fleet_cash_closing(p_dia date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_fleet_id uuid;
  v_dia      date := COALESCE(p_dia, current_date);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessao'; END IF;
  SELECT id INTO v_fleet_id FROM public.fleets WHERE owner_user_id = auth.uid();
  IF v_fleet_id IS NULL THEN RAISE EXCEPTION 'Sem frota'; END IF;

  RETURN jsonb_build_object(
    'fleet_id', v_fleet_id,
    'dia', v_dia,

    -- Por restaurante: o que se deve, e o que ja esta em cima da mesa.
    'restaurantes', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'divida_aberta')::numeric DESC)
      FROM (
        SELECT jsonb_build_object(
          'business_id', p.id,
          'nome', p.name,
          'divida_aberta', round(public.divida_comida_em_aberto(v_fleet_id, p.id), 2),
          'recolhido_no_dia', round(COALESCE((
            SELECT SUM(e.amount) FROM public.ledger_entries e
            WHERE e.account_kind = 'fleet' AND e.fleet_id = v_fleet_id
              AND e.business_id = p.id AND e.entry_type = 'divida_comida'
              AND e.created_at::date = v_dia
              AND e.reverses_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM public.ledger_entries r WHERE r.reverses_id = e.id)
          ), 0), 2),
          'declarado_por_confirmar', round(COALESCE((
            SELECT SUM(s.amount) FROM public.cash_settlements s
            WHERE s.fleet_id = v_fleet_id AND s.business_id = p.id AND s.status = 'declarado'
          ), 0), 2),
          'confirmado_no_dia', round(COALESCE((
            SELECT SUM(s.amount) FROM public.cash_settlements s
            WHERE s.fleet_id = v_fleet_id AND s.business_id = p.id
              AND s.status = 'confirmado' AND s.dia = v_dia
          ), 0), 2)
        ) AS x
        FROM public.profiles p
        WHERE EXISTS (
          SELECT 1 FROM public.ledger_entries e
          WHERE e.account_kind = 'fleet' AND e.fleet_id = v_fleet_id
            AND e.business_id = p.id AND e.entry_type IN ('divida_comida','entrega_dinheiro')
        )
      ) t
      -- Restaurantes ja saldados nao enchem o ecra, mas o dia em que houve
      -- movimento continua a aparecer.
      WHERE (x->>'divida_aberta')::numeric <> 0
         OR (x->>'recolhido_no_dia')::numeric <> 0
         OR (x->>'confirmado_no_dia')::numeric <> 0
    ), '[]'::jsonb),

    -- Quem andou com o dinheiro (§39). Dado registado, nao metrica calculada.
    'motoristas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'driver_id', d.id, 'nome', d.name,
        'entregas_no_dia', cnt.n,
        'dinheiro_recolhido', round(cnt.total, 2)
      ) ORDER BY cnt.total DESC)
      FROM (
        SELECT e.driver_id, count(*) AS n, COALESCE(SUM(e.amount), 0) AS total
        FROM public.ledger_entries e
        WHERE e.account_kind = 'fleet' AND e.fleet_id = v_fleet_id
          AND e.entry_type = 'divida_comida' AND e.created_at::date = v_dia
          AND e.driver_id IS NOT NULL
          AND e.reverses_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM public.ledger_entries r WHERE r.reverses_id = e.id)
        GROUP BY e.driver_id
      ) cnt
      JOIN public.drivers d ON d.id = cnt.driver_id
    ), '[]'::jsonb),

    'acertos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'business_id', s.business_id,
        'nome', (SELECT name FROM public.profiles WHERE id = s.business_id),
        'dia', s.dia, 'valor', s.amount, 'estado', s.status,
        'motivo_contestacao', s.contest_reason,
        'declarado_em', s.declared_at, 'resolvido_em', s.resolved_at
      ) ORDER BY s.declared_at DESC)
      FROM public.cash_settlements s
      WHERE s.fleet_id = v_fleet_id AND (s.dia = v_dia OR s.status = 'declarado')
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_fleet_cash_closing(date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_fleet_cash_closing(date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. O que o RESTAURANTE tem para confirmar
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_business_cash_settlements(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessao'; END IF;
  IF NOT public.is_business_owner(p_business_id) AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN jsonb_build_object(
    'business_id', p_business_id,
    'a_receber_total', round(COALESCE((
      SELECT -SUM(e.amount) FROM public.ledger_entries e
      WHERE e.account_kind = 'business' AND e.business_id = p_business_id
        AND e.entry_type IN ('credito_comida', 'recebimento_dinheiro')
        AND e.reverses_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.ledger_entries r WHERE r.reverses_id = e.id)
    ), 0), 2),
    'acertos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'fleet_id', s.fleet_id,
        'frota', (SELECT name FROM public.fleets WHERE id = s.fleet_id),
        'dia', s.dia, 'valor', s.amount, 'estado', s.status,
        'nota', s.note, 'motivo_contestacao', s.contest_reason,
        'declarado_em', s.declared_at, 'resolvido_em', s.resolved_at
      ) ORDER BY (s.status = 'declarado') DESC, s.declared_at DESC)
      FROM public.cash_settlements s WHERE s.business_id = p_business_id
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_business_cash_settlements(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_business_cash_settlements(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Ensinar os leitores da Fase 6 a contar os tipos novos
-- ---------------------------------------------------------------------------
-- SEM ISTO A FASE INTEIRA NAO SE VE. Os dois leitores somam por entry_type
-- exacto, portanto uma liquidacao perfeitamente escrita no ledger deixava a
-- divida na mesma no painel -- a pior especie de avaria, porque tudo "funciona".
--
-- Substituicao cirurgica sobre a definicao VIVA, com assercao: se a expressao
-- nao estiver como se espera, ABORTA em vez de fingir que corrigiu.
DO $do$
DECLARE
  v_def  text;
  v_novo text;
BEGIN
  -- get_business_commission: food_receivable
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_business_commission';

  v_novo := replace(v_def,
    'WHEN e.entry_type=''credito_comida'' THEN e.amount',
    'WHEN e.entry_type IN (''credito_comida'',''recebimento_dinheiro'') THEN e.amount');

  IF v_novo = v_def THEN
    RAISE EXCEPTION 'get_business_commission: nao encontrei a soma de credito_comida';
  END IF;
  EXECUTE v_novo;

  -- get_fleet_financials: divida_restaurantes
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_fleet_financials';

  v_novo := replace(v_def,
    'FROM vivas WHERE entry_type=''divida_comida''',
    'FROM vivas WHERE entry_type IN (''divida_comida'',''entrega_dinheiro'')');

  IF v_novo = v_def THEN
    RAISE EXCEPTION 'get_fleet_financials: nao encontrei a soma de divida_comida';
  END IF;
  EXECUTE v_novo;

  -- Confirmar o que ficou instalado.
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_business_commission';
  IF v_def NOT LIKE '%recebimento_dinheiro%' THEN
    RAISE EXCEPTION 'get_business_commission nao ficou a contar os recebimentos';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_fleet_financials';
  IF v_def NOT LIKE '%entrega_dinheiro%' THEN
    RAISE EXCEPTION 'get_fleet_financials nao ficou a contar as entregas de dinheiro';
  END IF;
END
$do$;
