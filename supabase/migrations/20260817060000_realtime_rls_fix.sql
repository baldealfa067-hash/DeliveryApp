-- ============================================================
-- CORREÇÃO CRÍTICA: Políticas RLS para Realtime
-- PROBLEMA: Tabelas no supabase_realtime tinham só políticas SELECT.
--           O Supabase Realtime verifica RLS ao entregar eventos
--           postgres_changes ao cliente. Sem INSERT/UPDATE policies,
--           os eventos são filtrados e o frontend nunca os recebe.
-- SOLUÇÃO: Adicionar políticas INSERT/UPDATE para authenticated.
-- ============================================================

-- 1. provider_stats: permitir INSERT/UPDATE via RPC (SECURITY DEFINER já escreve,
--    mas o Realtime precisa destas políticas para entregar eventos ao cliente)
DROP POLICY IF EXISTS "Service role can insert provider stats" ON public.provider_stats;
CREATE POLICY "Service role can insert provider stats" ON public.provider_stats
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can update provider stats" ON public.provider_stats;
CREATE POLICY "Service role can update provider stats" ON public.provider_stats
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- 2. provider_activity: permitir INSERT/UPDATE
DROP POLICY IF EXISTS "Service role can insert provider activity" ON public.provider_activity;
CREATE POLICY "Service role can insert provider activity" ON public.provider_activity
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can update provider activity" ON public.provider_activity;
CREATE POLICY "Service role can update provider activity" ON public.provider_activity
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- 3. notifications: permitir INSERT/UPDATE (trigger escreve, realtime entrega)
DROP POLICY IF EXISTS "Service role can insert notifications" ON public.notifications;
CREATE POLICY "Service role can insert notifications" ON public.notifications
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can update notifications" ON public.notifications;
CREATE POLICY "Service role can update notifications" ON public.notifications
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
