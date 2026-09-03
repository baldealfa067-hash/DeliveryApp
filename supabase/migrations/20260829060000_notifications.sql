-- ============================================================
-- Etapa 8: Sistema de Notificações por Evento
-- ============================================================

-- 1. Tabela de notificações
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  type text NOT NULL DEFAULT 'info', -- info, order, appointment, delivery, system
  reference_type text, -- order, appointment, delivery, report
  reference_id uuid,
  is_read boolean DEFAULT false NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
ON public.notifications FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Users can mark own notifications read"
ON public.notifications FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Service role can insert notifications"
ON public.notifications FOR INSERT
TO service_role
WITH CHECK (true);

GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

CREATE INDEX idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX idx_notifications_created_at ON public.notifications(created_at DESC);
CREATE INDEX idx_notifications_unread ON public.notifications(user_id, is_read) WHERE is_read = false;

-- 2. RPC: Criar notificação
CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id uuid,
  p_title text,
  p_message text,
  p_type text DEFAULT 'info',
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.notifications (user_id, title, message, type, reference_type, reference_id)
  VALUES (p_user_id, p_title, p_message, p_type, p_reference_type, p_reference_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_notification(uuid, text, text, text, text, uuid) TO service_role;

-- 3. RPC: Buscar notificações do utilizador
CREATE OR REPLACE FUNCTION public.get_my_notifications(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  title text,
  message text,
  type text,
  reference_type text,
  reference_id uuid,
  is_read boolean,
  created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT n.id, n.title, n.message, n.type, n.reference_type, n.reference_id, n.is_read, n.created_at
  FROM public.notifications n
  WHERE n.user_id = auth.uid()
  ORDER BY n.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_notifications(integer, integer) TO authenticated;

-- 4. RPC: Contar não lidas
CREATE OR REPLACE FUNCTION public.get_unread_notifications_count()
RETURNS integer
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM public.notifications
  WHERE user_id = auth.uid() AND is_read = false;
$$;

GRANT EXECUTE ON FUNCTION public.get_unread_notifications_count() TO authenticated;

-- 5. RPC: Marcar como lidas
CREATE OR REPLACE FUNCTION public.mark_notifications_read(p_ids uuid[] DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_ids IS NULL THEN
    UPDATE public.notifications SET is_read = true WHERE user_id = auth.uid() AND is_read = false;
  ELSE
    UPDATE public.notifications SET is_read = true WHERE user_id = auth.uid() AND id = ANY(p_ids);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_notifications_read(uuid[]) TO authenticated;

-- 6. Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
