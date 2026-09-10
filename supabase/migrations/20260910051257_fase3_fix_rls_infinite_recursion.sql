-- FASE 3 (correccao critica) -- recursao infinita nas policies de `fleets`.
--
-- SINTOMA: qualquer leitura de `fleets` por um utilizador normal devolvia
--   42P17 infinite recursion detected in policy for relation "fleets"
-- ou seja, HTTP 500. Atingia getPostLoginDestination (le' `fleets` directamente)
-- e o separador de precos do painel (le' `fleet_zone_prices`, cuja policy
-- entrava no mesmo ciclo). As RPCs escapavam por serem SECURITY DEFINER, o que
-- tornava a avaria intermitente e mais dificil de ler.
--
-- CAUSA: as policies apontavam uma para a outra.
--   fleets  SELECT -> EXISTS (SELECT FROM drivers ...)   [o motorista ve' a sua frota]
--   drivers SELECT -> EXISTS (SELECT FROM fleets ...)    [a frota ve' os seus motoristas]
-- Ler `fleets` avalia a policy, que le' `drivers`, que avalia a policy, que le'
-- `fleets`... O Postgres deteta e aborta.
--
-- PORQUE NAO FOI APANHADO ANTES: o teste de ponta a ponta da Fase 3 correu por
-- MCP, com service_role, que ignora RLS por completo. Passou com sete
-- assertivas verdes sobre codigo que nenhum utilizador real conseguia executar.
-- So' apareceu num pedido HTTP autenticado como utilizador normal. Licao:
-- testar RLS com service_role nao testa RLS nenhum.
--
-- CORRECCAO: quebrar o ciclo com funcoes SECURITY DEFINER. Dentro delas o RLS
-- da tabela consultada nao e' reavaliado, portanto nao ha volta ao ponto de
-- partida. E' o mesmo padrao que `has_role` ja' usa neste esquema.

CREATE OR REPLACE FUNCTION public.owns_fleet(p_fleet_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.fleets f
    WHERE f.id = p_fleet_id AND f.owner_user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_driver_of_fleet(p_fleet_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.drivers d
    WHERE d.fleet_id = p_fleet_id AND d.user_id = auth.uid()
  );
$$;

-- ── fleets ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Fleet owner reads own fleet" ON public.fleets;
CREATE POLICY "Fleet owner reads own fleet"
ON public.fleets FOR SELECT TO authenticated
USING (
  owner_user_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin')
  OR public.is_driver_of_fleet(id)
);

-- ── drivers ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Fleet owner reads own drivers" ON public.drivers;
CREATE POLICY "Fleet owner reads own drivers"
ON public.drivers FOR SELECT TO authenticated
USING (public.owns_fleet(fleet_id));

DROP POLICY IF EXISTS "Fleet owner updates own drivers" ON public.drivers;
CREATE POLICY "Fleet owner updates own drivers"
ON public.drivers FOR UPDATE TO authenticated
USING (public.owns_fleet(fleet_id))
WITH CHECK (public.owns_fleet(fleet_id));

-- ── fleet_zone_prices ───────────────────────────────────────────────────────
-- Nao fechava ciclo nenhum (nada em `fleets` aponta a esta tabela), mas passa a
-- usar a mesma funcao: uma so' definicao de "sou dono desta frota", em vez da
-- mesma subconsulta repetida em quatro policies.
DROP POLICY IF EXISTS "Fleet owner reads own prices" ON public.fleet_zone_prices;
CREATE POLICY "Fleet owner reads own prices"
ON public.fleet_zone_prices FOR SELECT TO authenticated
USING (public.owns_fleet(fleet_id) OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Fleet owner writes own prices" ON public.fleet_zone_prices;
CREATE POLICY "Fleet owner writes own prices"
ON public.fleet_zone_prices FOR ALL TO authenticated
USING (public.owns_fleet(fleet_id))
WITH CHECK (public.owns_fleet(fleet_id));

-- Regra de 20260910033308: revogar dos DOIS. Estas nao sao avaliadas em nenhuma
-- policy aplicada ao papel anonimo -- ao contrario de `has_role` -- portanto
-- podem e devem ficar fechadas ao `anon`.
REVOKE EXECUTE ON FUNCTION public.owns_fleet(uuid)          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_driver_of_fleet(uuid)  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.owns_fleet(uuid)          TO authenticated;
GRANT  EXECUTE ON FUNCTION public.is_driver_of_fleet(uuid)  TO authenticated;
