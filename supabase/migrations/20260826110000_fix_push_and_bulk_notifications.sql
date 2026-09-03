-- Correções críticas para notificações push e notificações em massa
-- 1. Garantir que pg_net está disponível
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;

-- 2. Corrigir o trigger push para NÃO apagar a notificação in-app se o push falhar
--    Antes: PERFORM net.http_post(...) — qualquer erro faz rollback da notificação
--    Agora: bloco BEGIN...EXCEPTION que ignora erros de push
CREATE OR REPLACE FUNCTION public.push_after_notification()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM net.http_post(
      'https://pfvuqehchkamhgjlugqn.supabase.co/functions/v1/push-send',
      jsonb_build_object(
        'kind', 'notification',
        'user_id', NEW.user_id::text,
        'type', NEW.type,
        'title', NEW.title,
        'body', NEW.body,
        'link', COALESCE(NEW.link, '/'),
        'request_id', NEW.request_id::text
      ),
      '{}'::jsonb,
      jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmdnVxZWhjaGthbWhnamx1Z3FuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4OTM2MjgsImV4cCI6MjEwMjQ2OTYyOH0.cGAHjlkhF89jpMBEiX9YujcUqYYBYXeQncn0oFLw5fs'
      ),
      5000
    );
  EXCEPTION WHEN OTHERS THEN
    -- Push falhou, mas a notificação in-app fica garantida
    RAISE NOTICE 'push_after_notification falhou: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- 3. Função send_bulk_notification melhorada — inclui beleza como grupo válido
--    (a função original já funciona com qualquer valor do enum app_role,
--     mas adicionamos proteção extra contra grupos inválidos)
CREATE OR REPLACE FUNCTION public.send_bulk_notification(
  p_title text,
  p_body text,
  p_target_groups text[]
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_group text;
  v_user_ids uuid[];
  v_uid uuid;
  v_bulk_id uuid;
  v_valid_groups text[] := ARRAY['provider', 'business', 'client', 'beleza', 'admin'];
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Apenas administradores podem enviar notificações em massa';
  END IF;

  IF p_title IS NULL OR trim(p_title) = '' THEN
    RAISE EXCEPTION 'Título é obrigatório';
  END IF;
  IF p_body IS NULL OR trim(p_body) = '' THEN
    RAISE EXCEPTION 'Mensagem é obrigatória';
  END IF;
  IF p_target_groups IS NULL OR array_length(p_target_groups, 1) = 0 THEN
    RAISE EXCEPTION 'Selecione pelo menos um público-alvo';
  END IF;

  -- Validar grupos
  FOREACH v_group IN ARRAY p_target_groups
  LOOP
    IF NOT (v_group = ANY(v_valid_groups)) THEN
      RAISE EXCEPTION 'Grupo inválido: %', v_group;
    END IF;
  END LOOP;

  INSERT INTO public.admin_notifications (title, body, target_groups, sent_by)
  VALUES (p_title, p_body, p_target_groups, auth.uid())
  RETURNING id INTO v_bulk_id;

  FOREACH v_group IN ARRAY p_target_groups
  LOOP
    SELECT array_agg(DISTINCT ur.user_id) INTO v_user_ids
    FROM public.user_roles ur
    WHERE ur.role = v_group::app_role;

    IF v_user_ids IS NOT NULL THEN
      FOREACH v_uid IN ARRAY v_user_ids
      LOOP
        INSERT INTO public.notifications (user_id, type, title, body, link)
        VALUES (v_uid, 'admin_message', p_title, p_body, '/perfil');
        v_count := v_count + 1;
      END LOOP;
    END IF;
  END LOOP;

  UPDATE public.admin_notifications SET recipients_count = v_count WHERE id = v_bulk_id;

  RETURN v_count;
END;
$$;
