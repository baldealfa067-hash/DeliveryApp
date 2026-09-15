-- FASE 6.1 -- as agregacoes de base passam a descontar reversoes (§84).
--
-- O DEFEITO QUE ISTO CORRIGE. `get_business_commission.total_sales` descontava
-- a base com este teste:
--
--     WHEN reverses_id IS NOT NULL AND amount > 0 THEN -base_amount
--
-- A reversao de `comissao_restaurante` tem `amount < 0` -- cai no ELSE 0 e nao
-- desconta nada. Quem descontava era a reversao de `credito_comida`, que so
-- existe em pagamento a dinheiro. Medido antes desta migracao:
--
--     pedido `entrega` concluido e cancelado -> total_sales 0      (certo, por acaso)
--     pedido `online`  concluido e cancelado -> total_sales 10000  (devia ser 0)
--
-- Acertava por coincidencia num caso e mentia no outro. As dividas (somas de
-- `amount`) estavam certas -- so os totais de VOLUME e' que estavam errados.
--
-- A REGRA UNIFORME que substitui o CASE: uma entrada esta' VIVA quando nao e'
-- uma reversao e nao foi revertida. Todas as contas passam a correr so' sobre
-- entradas vivas, e o caso especial desaparece do meio das somas -- passa a
-- estar no WHERE, uma vez, onde se ve'.
--
-- Nao se apaga nada (§56): a original e a reversao continuam ambas na tabela e
-- ambas aparecem no extracto de movimentos, marcadas. O que muda e' so' quem
-- entra nos TOTAIS.
--
-- Contas cruzadas separadas em duas, em vez de somadas. `counterparty='fleet'`
-- na conta do restaurante juntava "tenho a receber da frota" (comida, §28) com
-- "tenho a pagar a' frota" (taxa de entrega em pagamento online). Somados dao
-- um numero que nao quer dizer nada. Agora sao dois campos, por tipo de
-- entrada, e cada ecra mostra o que e'.

-- ---------------------------------------------------------------------------
-- 1. Conta corrente do restaurante
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_business_commission(uuid);
CREATE FUNCTION public.get_business_commission(p_business_id uuid)
RETURNS TABLE(
  total_sales        numeric,
  commission_rate    numeric,
  commission_due     numeric,
  commission_paid    numeric,
  commission_balance numeric,
  food_receivable    numeric,
  delivery_payable   numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  SELECT user_id INTO v_owner FROM public.profiles WHERE id = p_business_id;
  IF v_owner IS NULL OR (v_owner IS DISTINCT FROM auth.uid() AND NOT public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(SUM(CASE WHEN e.entry_type='comissao_restaurante' THEN e.base_amount ELSE 0 END), 0),
    -- A taxa ACTUAL, so' para mostrar "a comissao e' de X%". NAO entra em conta
    -- nenhuma aqui: as contas saem das linhas, cada uma com a taxa que valia.
    (SELECT COALESCE(NULLIF(value,'')::numeric, 5) FROM public.platform_settings WHERE key='commission_rate'),
    COALESCE(SUM(CASE WHEN e.counterparty='platform' AND e.entry_type <> 'pagamento_comissao' THEN e.amount ELSE 0 END), 0),
    COALESCE(-SUM(CASE WHEN e.entry_type='pagamento_comissao' THEN e.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN e.counterparty='platform' THEN e.amount ELSE 0 END), 0),
    -- §28: a frota tem a entregar a comida recebida em dinheiro. Linha
    -- negativa (a receber); mostra-se em positivo.
    COALESCE(-SUM(CASE WHEN e.entry_type='credito_comida' THEN e.amount ELSE 0 END), 0),
    -- Pagamento online: o restaurante recebeu tambem a taxa de entrega e
    -- tem de a entregar a' frota. Linha positiva (deve).
    COALESCE(SUM(CASE WHEN e.entry_type='divida_entrega' THEN e.amount ELSE 0 END), 0)
  FROM public.ledger_entries e
  WHERE e.business_id = p_business_id
    AND e.account_kind = 'business'
    -- Vivas: nem reversao, nem revertida.
    AND e.reverses_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.ledger_entries r WHERE r.reverses_id = e.id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_business_commission(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_business_commission(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Conta corrente da frota (§32)
-- ---------------------------------------------------------------------------
-- RPC e nao leitura directa de `deliveries`: decisao de 2026-09-10 -- essa
-- tabela devolve lista vazia SEM ERRO ao JWT da frota, portanto codigo novo que
-- a lesse parecia funcionar e nao mostrava nada.
CREATE OR REPLACE FUNCTION public.get_fleet_financials()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_fleet_id  uuid;
  v_resultado jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessao'; END IF;

  SELECT id INTO v_fleet_id FROM public.fleets WHERE owner_user_id = auth.uid();
  IF v_fleet_id IS NULL THEN RAISE EXCEPTION 'Sem frota'; END IF;

  WITH vivas AS (
    SELECT e.* FROM public.ledger_entries e
    WHERE e.fleet_id = v_fleet_id
      AND e.account_kind = 'fleet'
      AND e.reverses_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.ledger_entries r WHERE r.reverses_id = e.id)
  )
  SELECT jsonb_build_object(
    'fleet_id', v_fleet_id,
    'taxa_actual', (SELECT COALESCE(NULLIF(value,'')::numeric,5) FROM public.platform_settings WHERE key='commission_rate'),
    -- Uma entrega cancelada deixa de contar como faturada. Antes contava:
    -- a reversao tem entry_type 'reversao' e nao apagava a original da soma.
    'entregas_faturadas', (SELECT count(*)                  FROM vivas WHERE entry_type='comissao_frota'),
    'valor_entregas',     (SELECT COALESCE(SUM(base_amount),0) FROM vivas WHERE entry_type='comissao_frota'),
    'comissao_gerada',    (SELECT COALESCE(SUM(amount),0)   FROM vivas WHERE counterparty='platform' AND entry_type <> 'pagamento_comissao'),
    'comissao_paga',      (SELECT COALESCE(-SUM(amount),0)  FROM vivas WHERE entry_type='pagamento_comissao'),
    'divida_plataforma',  (SELECT COALESCE(SUM(amount),0)   FROM vivas WHERE counterparty='platform'),
    -- §28, dinheiro na entrega: a frota recebeu a comida e tem de a entregar.
    'divida_restaurantes',   (SELECT COALESCE(SUM(amount),0)  FROM vivas WHERE entry_type='divida_comida'),
    -- Pagamento online: foi o restaurante que recebeu tudo, e deve a taxa de
    -- entrega a' frota. Linha negativa (a receber); mostra-se em positivo.
    'a_receber_restaurantes',(SELECT COALESCE(-SUM(amount),0) FROM vivas WHERE entry_type='credito_entrega'),
    -- §84: o extracto mostra TUDO, reversoes incluidas e marcadas. So' os
    -- totais acima e' que correm sobre as vivas -- o historico nao se esconde.
    'movimentos', COALESCE((
      SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object(
          'id', e.id, 'tipo', e.entry_type, 'contraparte', e.counterparty,
          'valor', e.amount, 'base', e.base_amount, 'taxa', e.rate,
          'pedido', o.order_number, 'nota', e.note, 'quando', e.created_at,
          'revertida', EXISTS (SELECT 1 FROM public.ledger_entries r WHERE r.reverses_id = e.id)
        ) AS x
        FROM public.ledger_entries e
        LEFT JOIN public.orders o ON o.id = e.order_id
        WHERE e.fleet_id = v_fleet_id AND e.account_kind = 'fleet'
        ORDER BY e.created_at DESC LIMIT 50
      ) x), '[]'::jsonb)
  ) INTO v_resultado;

  RETURN v_resultado;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_fleet_financials() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_fleet_financials() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Visao do admin -- as duas contas separadas (§26, §55)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_all_commissions();
CREATE FUNCTION public.get_all_commissions()
RETURNS TABLE(
  account_kind       text,
  account_id         uuid,
  account_name       text,
  total_base         numeric,
  commission_due     numeric,
  commission_paid    numeric,
  commission_balance numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Apenas administradores';
  END IF;

  RETURN QUERY
  WITH vivas AS (
    SELECT e.* FROM public.ledger_entries e
    WHERE e.counterparty = 'platform'
      AND e.reverses_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.ledger_entries r WHERE r.reverses_id = e.id)
  )
  SELECT 'business'::text, p.id, p.name,
         COALESCE(SUM(CASE WHEN v.entry_type='comissao_restaurante' THEN v.base_amount ELSE 0 END),0),
         COALESCE(SUM(CASE WHEN v.entry_type <> 'pagamento_comissao' THEN v.amount ELSE 0 END),0),
         COALESCE(-SUM(CASE WHEN v.entry_type='pagamento_comissao' THEN v.amount ELSE 0 END),0),
         COALESCE(SUM(v.amount),0)
  FROM vivas v JOIN public.profiles p ON p.id = v.business_id
  WHERE v.account_kind='business'
  GROUP BY p.id, p.name

  UNION ALL

  SELECT 'fleet'::text, f.id, f.name,
         COALESCE(SUM(CASE WHEN v.entry_type='comissao_frota' THEN v.base_amount ELSE 0 END),0),
         COALESCE(SUM(CASE WHEN v.entry_type <> 'pagamento_comissao' THEN v.amount ELSE 0 END),0),
         COALESCE(-SUM(CASE WHEN v.entry_type='pagamento_comissao' THEN v.amount ELSE 0 END),0),
         COALESCE(SUM(v.amount),0)
  FROM vivas v JOIN public.fleets f ON f.id = v.fleet_id
  WHERE v.account_kind='fleet'
  GROUP BY f.id, f.name

  ORDER BY 7 DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_all_commissions() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_all_commissions() TO authenticated;
