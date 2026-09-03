-- ============================================================
-- Notificação ao dono do pedido quando alguém se candidata
-- Versão IDEMPOTENTE — pode correr várias vezes (SQL Editor)
-- ============================================================

CREATE OR REPLACE FUNCTION public.notify_owner_on_bid()
RETURNS TRIGGER AS $$
DECLARE
  owner_user uuid;
  provider_name text;
  req_category text;
BEGIN
  SELECT sr.user_id, sr.category INTO owner_user, req_category
  FROM public.service_requests sr WHERE sr.id = NEW.request_id;

  SELECT p.name INTO provider_name
  FROM public.profiles p WHERE p.id = NEW.provider_id;

  IF owner_user IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      owner_user,
      'nova_candidatura',
      'Nova candidatura: ' || COALESCE(req_category, ''),
      COALESCE(provider_name, 'Um prestador') || ' candidatou-se ao seu pedido' ||
        CASE WHEN NEW.message IS NOT NULL AND NEW.message != ''
          THEN ' — "' || LEFT(NEW.message, 100) || '"'
          ELSE ''
        END,
      '/pedidos'
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_bid_created ON public.request_bids;
CREATE TRIGGER on_bid_created
  AFTER INSERT ON public.request_bids
  FOR EACH ROW EXECUTE FUNCTION public.notify_owner_on_bid();
