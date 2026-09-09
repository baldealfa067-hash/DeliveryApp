-- FASE 1 -- remover policies duplicadas que se anulam ou se repetem.
--
-- Policies permissivas combinam com OR. Quando duas cobrem o mesmo comando, a
-- mais permissiva e' a que vale -- a outra e' decoracao que engana quem le.

-- ===========================================================================
-- profiles -- dois pares duplicados
-- ===========================================================================
-- CORRECCAO A UMA CONCLUSAO DA AUDITORIA: escrevi que largar a policy
-- permissiva apertava a seguranca. E' o contrario, e a migracao
-- 20260907092528 ja' o explicava:
--
--   "Providers can update own profile"  WITH CHECK exige
--        is_verified = false AND verification_status NOT IN (aprovado, rejeitado)
--   -- ou seja, assim que o restaurante e' APROVADO, o dono deixa de poder
--   editar a propria loja: morada, numero de pagamento, tempo de preparacao.
--   Nao e' seguranca, e' um bloqueio herdado do Bornaal.
--
-- A proteccao real contra a auto-verificacao e' o trigger
-- trg_protect_profile_verification, que esta' activo e repoe is_verified,
-- verification_status e verification_reason quando quem edita nao e' admin.
--
-- Portanto larga-se a restritiva e fica a simples + trigger, que e' o
-- comportamento que ja' estava de facto em vigor.
DROP POLICY IF EXISTS "Providers can update own profile" ON public.profiles;

-- O par de INSERT: a antiga exige o papel `provider`, que no DeliveryApp
-- ninguem novo tem -- um restaurante tem o papel `business`. Mante-la seria
-- guardar uma regra da vertical de servicos que foi removida.
DROP POLICY IF EXISTS "Providers can insert own profile" ON public.profiles;

-- Ficam: "Providers update own profile" (auth.uid() = user_id),
--        "Providers insert own profile" (auth.uid() = user_id),
--        "Profiles are viewable by everyone",
--        "Admins manage profiles".

-- ===========================================================================
-- notifications -- oito policies, tres a mais
-- ===========================================================================
-- Duplicado exacto de SELECT: (user_id = auth.uid()) vs (auth.uid() = user_id)
DROP POLICY IF EXISTS "Users see own notifications" ON public.notifications;

-- Duplicado exacto de UPDATE, mesma condicao escrita ao contrario
DROP POLICY IF EXISTS "Users can mark own notifications read" ON public.notifications;

-- USING (false) WITH CHECK (false) numa policy PERMISSIVA nao nega nada: as
-- permissivas somam-se com OR, portanto esta contribui zero. O nome sugere que
-- protege alguma coisa e nao protege. Quem realmente permite marcar como lida
-- e' "Users can mark own as read"; a negacao vem de nao existir mais nenhuma.
DROP POLICY IF EXISTS "No direct update notifications (except own)" ON public.notifications;
