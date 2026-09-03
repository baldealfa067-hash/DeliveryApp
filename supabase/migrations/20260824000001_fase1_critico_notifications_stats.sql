-- ============================================================
-- FASE 1 - CRÍTICO (2/7) - Notificações/Stats forjáveis P4-P6
-- Antes: qualquer authenticated podia INSERT/UPDATE com WITH CHECK (true)
--   → spoof de notificações e forjar estatísticas
-- Depois: INSERT direto bloqueado (WITH CHECK false), escrita só via
--   funções/triggers SECURITY DEFINER (bypass RLS). SELECT para realtime
--   continua via "Users see own notifications" / "Authenticated can view *"
-- Idempotente
-- ============================================================

-- 1. NOTIFICATIONS: bloquear INSERT forjado (P4) e UPDATE forjado (P5)
DROP POLICY IF EXISTS "System can insert notifications" ON public.notifications;
DROP POLICY IF EXISTS "Service role can insert notifications" ON public.notifications;
DROP POLICY IF EXISTS "Service role can update notifications" ON public.notifications;

-- Nenhum utilizador pode inserir diretamente; apenas triggers/RPCs SECURITY DEFINER inserem
CREATE POLICY "No direct insert notifications" ON public.notifications
  FOR INSERT TO authenticated WITH CHECK (false);

CREATE POLICY "No direct update notifications (except own)" ON public.notifications
  FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
-- Nota: "Users can mark own as read" (USING auth.uid()=user_id) e "Admins manage notifications"
-- continuam a permitir UPDATE legítimo (owner ou admin). A policy false acima só bloqueia
-- o canal genérico que permitia UPDATE em qualquer linha.

-- Garante que SELECT para realtime continua (owner ou admin)
-- Já existe: "Users see own notifications" (auth.uid()=user_id) e "Admins manage notifications"
-- Não tocar nelas.

-- 2. PROVIDER_STATS: bloquear forjar estatísticas (P6)
DROP POLICY IF EXISTS "Service role can insert provider stats" ON public.provider_stats;
DROP POLICY IF EXISTS "Service role can update provider stats" ON public.provider_stats;

CREATE POLICY "No direct insert provider stats" ON public.provider_stats
  FOR INSERT TO authenticated WITH CHECK (false);

CREATE POLICY "No direct update provider stats" ON public.provider_stats
  FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

-- SELECT já existe: "Authenticated can view provider stats" USING (true) - mantém para realtime/dashboard
-- Escritas só via increment_provider_view / record_provider_contact (SECURITY DEFINER, bypass RLS)

-- 3. PROVIDER_ACTIVITY: bloquear forjar atividade (P6)
DROP POLICY IF EXISTS "Service role can insert provider activity" ON public.provider_activity;
DROP POLICY IF EXISTS "Service role can update provider activity" ON public.provider_activity;

CREATE POLICY "No direct insert provider activity" ON public.provider_activity
  FOR INSERT TO authenticated WITH CHECK (false);

CREATE POLICY "No direct update provider activity" ON public.provider_activity
  FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

-- SELECT já existe: "Authenticated can view provider activity" USING (true) - mantém
