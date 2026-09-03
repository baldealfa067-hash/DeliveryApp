-- Notificar apenas prestadores verificados da mesma categoria
-- (e do mesmo bairro quando possível)
CREATE OR REPLACE FUNCTION public.notify_providers_on_request()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.notifications (user_id, type, title, body, link, request_id)
  SELECT p.user_id, 'novo_pedido',
    'Novo pedido em ' || NEW.category,
    'Um cliente precisa de ' || NEW.category || ' em ' || NEW.location ||
      CASE WHEN NEW.deadline IS NOT NULL AND NEW.deadline != ''
        THEN ' — Prazo: ' || NEW.deadline ELSE '' END,
    '/pedidos', NEW.id
  FROM public.profiles p
  WHERE p.category = NEW.category
    AND p.profile_type = 'provider'
    AND p.is_verified = true
    AND p.user_id IS NOT NULL
    AND p.user_id != COALESCE(NEW.user_id, '00000000-0000-0000-0000-000000000000'::uuid)
    -- se o prestador tem localização e coincide com o pedido, prioriza; caso contrário ainda notifica
    -- mantemos simples: notifica todos verificados da categoria, mas o body já contém a localização
  ;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_service_request_created ON public.service_requests;
CREATE TRIGGER on_service_request_created
  AFTER INSERT ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_providers_on_request();

-- Limite anti-spam: 3/dia para anónimos (por telefone), 10/dia para autenticados
CREATE OR REPLACE FUNCTION public.check_request_spam()
RETURNS TRIGGER AS $$
DECLARE
  cnt int;
  today_start timestamptz := date_trunc('day', now());
BEGIN
  IF NEW.user_id IS NULL THEN
    IF NEW.requester_phone IS NULL OR btrim(NEW.requester_phone) = '' THEN
      RAISE EXCEPTION 'Telefone é obrigatório para publicar sem conta';
    END IF;
    SELECT count(*) INTO cnt FROM public.service_requests
      WHERE requester_phone = NEW.requester_phone
        AND user_id IS NULL
        AND created_at >= today_start;
    IF cnt >= 3 THEN
      RAISE EXCEPTION 'Limite de 3 pedidos por dia atingido para este número. Cria conta ou tenta amanhã.';
    END IF;
  ELSE
    SELECT count(*) INTO cnt FROM public.service_requests
      WHERE user_id = NEW.user_id
        AND created_at >= today_start;
    IF cnt >= 10 THEN
      RAISE EXCEPTION 'Limite de 10 pedidos por dia atingido. Tenta amanhã.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_service_request_spam_check ON public.service_requests;
CREATE TRIGGER on_service_request_spam_check
  BEFORE INSERT ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION public.check_request_spam();
