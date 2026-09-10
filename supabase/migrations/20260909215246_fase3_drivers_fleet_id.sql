-- FASE 3 (Frotas) -- ligar o motorista a' frota.
--
-- NULLABLE de proposito (Aditamento 1.2): as contas de motorista legado, criadas
-- por auto-registo antes de a frota existir, ficam com fleet_id = NULL. Nao se
-- apagam nem se migram a' forca; ficam identificaveis como legado ate' haver
-- decisao. Uma coluna NOT NULL obrigaria a inventar uma frota para elas agora.

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS fleet_id uuid REFERENCES public.fleets(id);

CREATE INDEX IF NOT EXISTS drivers_fleet_id_idx ON public.drivers(fleet_id);

-- ---------------------------------------------------------------------------
-- §12: "o motorista nao deve ter acesso administrativo a' frota".
--
-- A policy `Drivers manage own profile` e' FOR ALL, portanto deixa o motorista
-- fazer UPDATE a' sua propria linha -- e a partir de agora isso incluiria
-- `fleet_id`, ou seja, mudar-se de frota sozinho ou sair de uma.
--
-- Resolve-se com privilegio ao nivel da COLUNA, nao com RLS: uma policy filtra
-- linhas, nao colunas, e um trigger seria mais codigo para o mesmo efeito.
-- Quem escreve `fleet_id` passa a ser exclusivamente as RPCs SECURITY DEFINER
-- da frota (migracao fase3_fleet_rpcs), que verificam se quem chama e' o dono.
-- ---------------------------------------------------------------------------
REVOKE UPDATE (fleet_id) ON public.drivers FROM authenticated;
REVOKE UPDATE (fleet_id) ON public.drivers FROM anon;

-- §46: a frota ve' os seus motoristas, e so' os seus.
DROP POLICY IF EXISTS "Fleet owner reads own drivers" ON public.drivers;
CREATE POLICY "Fleet owner reads own drivers"
ON public.drivers FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.fleets f
    WHERE f.id = drivers.fleet_id AND f.owner_user_id = auth.uid()
  )
);

-- A frota activa/desactiva os seus motoristas (§12). Nao lhes muda a frota por
-- aqui: `fleet_id` esta' fora do alcance de UPDATE para `authenticated`.
DROP POLICY IF EXISTS "Fleet owner updates own drivers" ON public.drivers;
CREATE POLICY "Fleet owner updates own drivers"
ON public.drivers FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.fleets f
    WHERE f.id = drivers.fleet_id AND f.owner_user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.fleets f
    WHERE f.id = drivers.fleet_id AND f.owner_user_id = auth.uid()
  )
);

-- Agora que `drivers.fleet_id` existe, o motorista passa a poder ler a frota a
-- que pertence -- precisa do nome para a interface, e nada mais lhe e' dado.
DROP POLICY IF EXISTS "Fleet owner reads own fleet" ON public.fleets;
CREATE POLICY "Fleet owner reads own fleet"
ON public.fleets FOR SELECT TO authenticated
USING (
  owner_user_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.drivers d
    WHERE d.fleet_id = fleets.id AND d.user_id = auth.uid()
  )
);
