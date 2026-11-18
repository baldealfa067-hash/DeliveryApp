-- Keep existing audiences available to older clients and add logistics roles.
CREATE OR REPLACE FUNCTION public.send_bulk_notification(
  p_title text,
  p_body text,
  p_target_groups text[]
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_sender uuid := auth.uid();
  v_title text := btrim(p_title);
  v_body text := btrim(p_body);
  v_count integer;
BEGIN
  IF v_sender IS NULL OR NOT public.has_role(v_sender, 'admin') THEN
    RAISE EXCEPTION 'Apenas administradores podem enviar notificações em massa'
      USING ERRCODE = '42501';
  END IF;

  IF v_title IS NULL OR char_length(v_title) NOT BETWEEN 1 AND 120
    OR v_body IS NULL OR char_length(v_body) NOT BETWEEN 1 AND 500
  THEN
    RAISE EXCEPTION 'Verifique o título e a mensagem' USING ERRCODE = '22023';
  END IF;

  IF coalesce(cardinality(p_target_groups), 0) = 0 OR EXISTS (
    SELECT 1 FROM unnest(p_target_groups) AS audience(role)
    WHERE audience.role IS NULL
      OR audience.role NOT IN ('client', 'business', 'fleet', 'driver', 'provider', 'beleza', 'admin')
  ) THEN
    RAISE EXCEPTION 'Selecione um público-alvo válido' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT DISTINCT ur.user_id, 'admin_message', v_title, v_body, '/notificacoes'
  FROM public.user_roles ur
  WHERE ur.role = ANY(p_target_groups::public.app_role[]);

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count > 0 THEN
    INSERT INTO public.admin_notifications (title, body, target_groups, sent_by, recipients_count)
    VALUES (v_title, v_body, p_target_groups, v_sender, v_count);
  END IF;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.send_bulk_notification(text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_bulk_notification(text, text, text[]) TO authenticated;
