-- FASE 3 (Frotas) -- a tabela `fleets`.
--
-- §11: uma frota pode ser uma empresa, uma pessoa com varias motos, um grupo de
-- motoristas ou uma operacao logistica. Uma so' entidade cobre os quatro casos.
--
-- Uma frota por utilizador na V1 (owner_user_id UNIQUE). §6: preparar a
-- arquitectura para evoluir, implementar so' o necessario. Se um dia um dono
-- precisar de varias frotas, cai-se o UNIQUE -- nada mais muda.
--
-- A leitura pelo motorista da sua propria frota entra na migracao seguinte,
-- quando `drivers.fleet_id` existir.

CREATE TABLE IF NOT EXISTS public.fleets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name           text NOT NULL,
  phone          text NOT NULL,
  bairro         text,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fleets_owner_user_id_idx ON public.fleets(owner_user_id);

ALTER TABLE public.fleets ENABLE ROW LEVEL SECURITY;

-- §46: a Frota A nao ve a Frota B. Ve' a sua, e o admin ve' todas.
DROP POLICY IF EXISTS "Fleet owner reads own fleet" ON public.fleets;
CREATE POLICY "Fleet owner reads own fleet"
ON public.fleets FOR SELECT TO authenticated
USING (owner_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Fleet owner creates own fleet" ON public.fleets;
CREATE POLICY "Fleet owner creates own fleet"
ON public.fleets FOR INSERT TO authenticated
WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS "Fleet owner updates own fleet" ON public.fleets;
CREATE POLICY "Fleet owner updates own fleet"
ON public.fleets FOR UPDATE TO authenticated
USING (owner_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
WITH CHECK (owner_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- Apagar uma frota arrasta motoristas e historico de entregas. So' o admin, e
-- so' depois de decidir o que fazer aos registos (§56).
DROP POLICY IF EXISTS "Only admin deletes fleets" ON public.fleets;
CREATE POLICY "Only admin deletes fleets"
ON public.fleets FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Postura explicita: o anonimo nao toca nesta tabela. Nao se herda a postura
-- por omissao do Supabase -- o achado de 20260909213622 ensinou que a heranca
-- silenciosa e' precisamente o que falha sem se dar por isso.
REVOKE ALL ON public.fleets FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.fleets TO authenticated;
GRANT ALL ON public.fleets TO service_role;
