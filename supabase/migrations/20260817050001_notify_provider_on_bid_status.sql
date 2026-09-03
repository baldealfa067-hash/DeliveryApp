-- ============================================================
-- Notificação ao prestador quando candidatura é aceite/recusada
-- Versão IDEMPOTENTE — pode correr várias vezes (SQL Editor)
-- ============================================================

CREATE OR REPLACE FUNCTION public.notify_provider_on_bid_status()
RETURNS TRIGGER AS $$
DECLARE
  provider_user uuid;
  req_category text;
  req_owner_name text;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  SELECT p.user_id INTO provider_user
  FROM public.profiles p WHERE p.id = NEW.provider_id;

  SELECT sr.category INTO req_category
  FROM public.service_requests sr WHERE sr.id = NEW.request_id;

  SELECT sr.requester_name INTO req_owner_name
  FROM public.service_requests sr WHERE sr.id = NEW.request_id;

  IF provider_user IS NOT NULL AND NEW.status IN ('aceite', 'recusado') THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      provider_user,
      'candidatura_' || NEW.status,
      CASE WHEN NEW.status = 'aceite'
        THEN 'Candidatura aceite!'
        ELSE 'Candidatura recusada'
      END,
      CASE WHEN NEW.status = 'aceite'
        THEN COALESCE(req_owner_name, 'O cliente') || ' aceitou a sua candidatura para "' || COALESCE(req_category, '') || '"'
        ELSE COALESCE(req_owner_name, 'O cliente') || ' recusou a sua candidatura para "' || COALESCE(req_category, '') || '"'
      END,
      '/pedidos'
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_bid_status_changed ON public.request_bids;
CREATE TRIGGER on_bid_status_changed
  AFTER UPDATE ON public.request_bids
  FOR EACH ROW EXECUTE FUNCTION public.notify_provider_on_bid_status();
