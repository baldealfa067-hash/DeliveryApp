-- FASE 4 (Motoristas) -- ganhos do motorista no proprio painel (§33, §83).
--
-- §83 ("principio de nao surpresa") diz que o motorista deve saber a sua
-- remuneracao. Ate' agora o painel mostrava CONTAGENS e QUILOMETROS, mas nunca
-- dinheiro: `delivery_fee` chegava a `get_my_deliveries` entrega a entrega
-- (20260910112301) e nao havia nenhum agregado.
--
-- NAO E' UMA RPC NOVA. `get_driver_delivery_stats` ja' existe, ja' agrega sobre
-- `deliveries` pelos mesmos tres periodos, e ja' tem a guarda certa -- o dono da
-- linha, corrigida para `IS DISTINCT FROM` em 20260907090337. Uma segunda RPC
-- seria um segundo sitio para essa guarda divergir. Acrescentam-se tres colunas.
--
-- MESMO PADRAO DE AGREGACAO de get_fleet_driver_detail (20260910142615):
-- `sum(delivery_fee) FILTER (WHERE status = 'entregue')`. Sai de `deliveries`,
-- onde `delivery_fee` foi congelado no checkout (Fase 3) -- nao se recalcula
-- nada a partir da tabela de precos, senao mudar o preco de um bairro
-- reescrevia retroactivamente os ganhos historicos, que e' exactamente o erro
-- que §30/§84 apontam ao calculo ao voo das comissoes.
--
-- `deliveries.status = 'entregue'` esta' correcto e NAO e' o estado morto que a
-- Fase 1 fundiu: `orders.status` e `deliveries.status` sao dominios de valores
-- diferentes, e do lado da entrega `entregue` e' o unico terminal de sucesso --
-- registado em 20260909155641.
--
-- SO' CONTA O QUE FOI ENTREGUE. Entregas aceites mas ainda por concluir nao
-- entram: dizer ao motorista que ja' ganhou dinheiro que ainda nao ganhou seria
-- afirmar o que nao se sabe.
--
-- ISTO NAO E' O LEDGER (§30). E' uma contagem ao voo do que o motorista
-- transportou, para ele ver no telefone. A repartição real do dinheiro -- quanto
-- e' do restaurante, quanto e' da frota, quanto e' comissao da plataforma
-- (§27-§29) -- e' a Fase 6, e nao se antecipa aqui.
--
-- DROP + CREATE porque RETURNS TABLE muda. Isso apaga o ACL da funcao: reposto
-- no fim, pela regra de 20260910033308 (revogar de PUBLIC **e** de anon, porque
-- os default privileges do Supabase dao concessao explicita ao anon).

DROP FUNCTION IF EXISTS public.get_driver_delivery_stats(uuid);

CREATE FUNCTION public.get_driver_delivery_stats(p_driver_id uuid)
RETURNS TABLE(
  today_count bigint,
  today_distance numeric,
  today_earnings numeric,
  week_count bigint,
  week_distance numeric,
  week_earnings numeric,
  month_count bigint,
  month_distance numeric,
  month_earnings numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  -- A guarda: so' o dono da linha. Um motorista da mesma frota nao passa aqui
  -- -- `p_driver_id` e' de outra pessoa, `v_owner` e' o user_id dessa pessoa, e
  -- nao coincide com auth.uid(). O dono da frota tambem nao: para ver os
  -- motoristas dele tem get_fleet_driver_detail, que verifica owns_fleet().
  --
  -- `IS DISTINCT FROM` e nao `<>`: com auth.uid() NULL (chamador anonimo),
  -- `v_owner <> NULL` avalia a NULL, o IF nunca dispara e a guarda era ignorada
  -- exactamente para quem devia bloquear. Foi um bypass real, corrigido em
  -- 20260907090337 -- nao reintroduzir `<>` aqui.
  SELECT user_id INTO v_owner FROM public.drivers WHERE id = p_driver_id;
  IF v_owner IS NULL OR v_owner IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE d.delivered_at >= CURRENT_DATE),
    COALESCE(SUM(d.distance_km)  FILTER (WHERE d.delivered_at >= CURRENT_DATE), 0)::numeric,
    COALESCE(SUM(d.delivery_fee) FILTER (WHERE d.delivered_at >= CURRENT_DATE), 0)::numeric,

    -- "Semana" = ultimos 7 dias a rolar, nao semana de calendario. Mantem-se
    -- como ja' estava para o numero nao mudar de significado debaixo dos pes de
    -- quem ja' o anda a ler.
    COUNT(*) FILTER (WHERE d.delivered_at >= CURRENT_DATE - INTERVAL '6 days'),
    COALESCE(SUM(d.distance_km)  FILTER (WHERE d.delivered_at >= CURRENT_DATE - INTERVAL '6 days'), 0)::numeric,
    COALESCE(SUM(d.delivery_fee) FILTER (WHERE d.delivered_at >= CURRENT_DATE - INTERVAL '6 days'), 0)::numeric,

    COUNT(*) FILTER (WHERE d.delivered_at >= date_trunc('month', CURRENT_DATE)),
    COALESCE(SUM(d.distance_km)  FILTER (WHERE d.delivered_at >= date_trunc('month', CURRENT_DATE)), 0)::numeric,
    COALESCE(SUM(d.delivery_fee) FILTER (WHERE d.delivered_at >= date_trunc('month', CURRENT_DATE)), 0)::numeric
  FROM public.deliveries d
  WHERE d.driver_id = p_driver_id
    AND d.status = 'entregue';
END;
$$;

COMMENT ON FUNCTION public.get_driver_delivery_stats(uuid) IS
  'Resumo do proprio motorista: entregas, km e ganhos (soma de delivery_fee das '
  'entregas concluidas) em hoje / ultimos 7 dias / mes corrente. Guarda: so o '
  'dono da linha em drivers. Nao e ledger (§30) -- conta ao voo, nao reparte '
  'dinheiro entre restaurante, frota e plataforma. Isso e a Fase 6.';

REVOKE EXECUTE ON FUNCTION public.get_driver_delivery_stats(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_driver_delivery_stats(uuid) TO authenticated;
