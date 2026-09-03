-- ============================================================
-- FIX: Alinhar notificações — RPCs + schema + push para chat
-- PROBLEMA: RPCs usam colunas (message, reference_type,
--           reference_id, is_read) que não existem na tabela
--           real (body, link, request_id, read). Resultado:
--           create_notification falha silenciosamente → push
--           nunca é enviado para mensagens.
-- ============================================================

-- 1. Adicionar colunas compatíveis com o código novo
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS message text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS reference_type text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS reference_id uuid;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS is_read boolean DEFAULT false;

-- 2. Sincronizar dados existentes: body→message, read→is_read, link→reference_type+reference_id
UPDATE public.notifications SET message = body WHERE message IS NULL;
UPDATE public.notifications SET is_read = read WHERE is_read IS NULL;

-- 3. Trigger: ao inserir com body, copia para message; ao inserir com read, copia para is_read
CREATE OR REPLACE FUNCTION public.sync_notification_columns()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.message IS NULL AND NEW.body IS NOT NULL THEN
    NEW.message := NEW.body;
  ELSIF NEW.body IS NULL AND NEW.message IS NOT NULL THEN
    NEW.body := NEW.message;
  END IF;
  IF NEW.is_read IS NULL AND NEW.read IS NOT NULL THEN
    NEW.is_read := NEW.read;
  ELSIF NEW.read IS NULL AND NEW.is_read IS NOT NULL THEN
    NEW.read := NEW.is_read;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_notification_cols ON public.notifications;
CREATE TRIGGER sync_notification_cols
  BEFORE INSERT OR UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.sync_notification_columns();

-- 4. Re-criar create_notification com colunas correctas
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
  v_link text;
BEGIN
  -- Build link from reference_type + reference_id
  IF p_reference_type IS NOT NULL AND p_reference_id IS NOT NULL THEN
    v_link := CASE p_reference_type
      WHEN 'order' THEN '/pedido/' || p_reference_id::text
      WHEN 'appointment' THEN '/meus-agendamentos/' || p_reference_id::text
      WHEN 'chat' THEN '/mensagem/' || p_reference_id::text
      ELSE '/'
    END;
  ELSIF p_reference_type = 'chat' AND p_reference_id IS NOT NULL THEN
    v_link := '/mensagem/' || p_reference_id::text;
  ELSE
    v_link := NULL;
  END IF;

  INSERT INTO public.notifications (user_id, title, body, message, type, link, reference_type, reference_id, read, is_read)
  VALUES (p_user_id, p_title, p_message, p_message, p_type, v_link, p_reference_type, p_reference_id, false, false)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_notification(uuid, text, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_notification(uuid, text, text, text, text, uuid) TO service_role;

-- 5. Re-criar get_my_notifications para retornar todas as colunas
CREATE OR REPLACE FUNCTION public.get_my_notifications(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  title text,
  message text,
  body text,
  type text,
  reference_type text,
  reference_id uuid,
  link text,
  is_read boolean,
  read boolean,
  created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT n.id, n.title, COALESCE(n.message, n.body), COALESCE(n.body, n.message),
         n.type, n.reference_type, n.reference_id, n.link,
         COALESCE(n.is_read, n.read), COALESCE(n.read, n.is_read), n.created_at
  FROM public.notifications n
  WHERE n.user_id = auth.uid()
  ORDER BY n.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_notifications(integer, integer) TO authenticated;

-- 6. Re-criar mark_notifications_read para usar ambas as colunas
CREATE OR REPLACE FUNCTION public.mark_notifications_read(p_ids uuid[] DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_ids IS NULL THEN
    UPDATE public.notifications SET read = true, is_read = true
    WHERE user_id = auth.uid() AND (read = false OR is_read = false);
  ELSE
    UPDATE public.notifications SET read = true, is_read = true
    WHERE user_id = auth.uid() AND id = ANY(p_ids);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_notifications_read(uuid[]) TO authenticated;

-- 7. Re-criar get_unread_notifications_count para usar ambas as colunas
CREATE OR REPLACE FUNCTION public.get_unread_notifications_count()
RETURNS integer
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM public.notifications
  WHERE user_id = auth.uid() AND (is_read = false OR read = false);
$$;

GRANT EXECUTE ON FUNCTION public.get_unread_notifications_count() TO authenticated;

-- 8. Índices para as novas colunas
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON public.notifications(user_id, is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_notifications_reference ON public.notifications(reference_type, reference_id);
