-- ============================================================
-- Notificação ao DONO do pedido quando uma candidatura é aceite/recusada
-- (confirmação ao cliente + contacto do prestador quando aceite)
-- Versão IDEMPOTENTE — pode correr várias vezes (SQL Editor)
-- ============================================================

CREATE OR REPLACE FUNCTION public.notify_owner_on_bid_status()
RETURNS TRIGGER AS $$
DECLARE
  owner_user uuid;
  provider_name text;
  provider_phone text;
  req_category text;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  SELECT sr.user_id, sr.category INTO owner_user, req_category
  FROM public.service_requests sr WHERE sr.id = NEW.request_id;

  SELECT p.name, p.phone INTO provider_name, provider_phone
  FROM public.profiles p WHERE p.id = NEW.provider_id;

  IF owner_user IS NOT NULL AND NEW.status IN ('aceite', 'recusado') THEN
    INSERT INTO public.notifications (user_id, type, title, body, link, request_id)
    VALUES (
      owner_user,
      'candidatura_' || NEW.status,
      CASE WHEN NEW.status = 'aceite'
        THEN 'Candidatura aceite'
        ELSE 'Candidatura recusada'
      END,
      CASE WHEN NEW.status = 'aceite'
        THEN 'Aceitou ' || COALESCE(provider_name, 'o prestador') ||
          ' para "' || COALESCE(req_category, '') || '"' ||
          CASE WHEN provider_phone IS NOT NULL AND provider_phone != ''
            THEN ' — Contacto: ' || provider_phone
            ELSE ''
          END
        ELSE 'Recusou a candidatura de ' || COALESCE(provider_name, 'o prestador') ||
          ' para "' || COALESCE(req_category, '') || '"'
      END,
      '/pedidos',
      NEW.request_id
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_bid_status_changed_owner ON public.request_bids;
CREATE TRIGGER on_bid_status_changed_owner
  AFTER UPDATE ON public.request_bids
  FOR EACH ROW EXECUTE FUNCTION public.notify_owner_on_bid_status();