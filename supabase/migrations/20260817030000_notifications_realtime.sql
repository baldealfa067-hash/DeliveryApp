-- Corrige bug: tabela notifications não estava no supabase_realtime.
-- Sem isto, a subscription no frontend (useNotificationsRealtime) nunca
-- recebia eventos — as notificações só apareciam após F5.

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
