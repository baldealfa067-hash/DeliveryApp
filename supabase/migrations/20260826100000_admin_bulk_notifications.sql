-- Notificações em massa pelo admin
-- 1. Tabela de histórico de notificações enviadas pelo admin
CREATE TABLE IF NOT EXISTS public.admin_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  target_groups text[] NOT NULL,
  sent_by uuid NOT NULL,
  recipients_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;

-- Apenas admin pode ler o histórico
CREATE POLICY "Admin read notifications history" ON public.admin_notifications
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Apenas via SECURITY DEFINER function (não via RLS direto)
GRANT SELECT ON public.admin_notifications TO authenticated;
GRANT ALL ON public.admin_notifications TO service_role;

-- 2. Tabela temporária para inserção em massa (evita LIMIT do Supabase REST)
-- Usamos uma function SECURITY DEFINER que busca os user_ids no servidor

-- 3. RPC: enviar notificação em massa
-- target_groups: array como ['provider', 'client', 'business']
-- Insere uma linha por utilizador-alvo na tabela notifications
-- (o trigger existente on_notification_created_push cuida do push)
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
BEGIN
  -- Verificar que o chamador é admin
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Apenas administradores podem enviar notificações em massa';
  END IF;

  -- Validar inputs
  IF p_title IS NULL OR trim(p_title) = '' THEN
    RAISE EXCEPTION 'Título é obrigatório';
  END IF;
  IF p_body IS NULL OR trim(p_body) = '' THEN
    RAISE EXCEPTION 'Mensagem é obrigatória';
  END IF;
  IF p_target_groups IS NULL OR array_length(p_target_groups, 1) = 0 THEN
    RAISE EXCEPTION 'Selecione pelo menos um público-alvo';
  END IF;

  -- Registrar no histórico
  INSERT INTO public.admin_notifications (title, body, target_groups, sent_by)
  VALUES (p_title, p_body, p_target_groups, auth.uid())
  RETURNING id INTO v_bulk_id;

  -- Para cada grupo-alvo, buscar os user_ids e inserir notificações
  FOREACH v_group IN ARRAY p_target_groups
  LOOP
    -- Buscar user_ids do grupo (user_roles)
    SELECT array_agg(DISTINCT ur.user_id) INTO v_user_ids
    FROM public.user_roles ur
    WHERE ur.role = v_group::app_role;

    -- Inserir notificação para cada user_id do grupo
    IF v_user_ids IS NOT NULL THEN
      FOREACH v_uid IN ARRAY v_user_ids
      LOOP
        INSERT INTO public.notifications (user_id, type, title, body, link)
        VALUES (v_uid, 'admin_message', p_title, p_body, '/perfil');
        v_count := v_count + 1;
      END LOOP;
    END IF;
  END LOOP;

  -- Atualizar contagem no registro
  UPDATE public.admin_notifications SET recipients_count = v_count WHERE id = v_bulk_id;

  RETURN v_count;
END;
$$;
