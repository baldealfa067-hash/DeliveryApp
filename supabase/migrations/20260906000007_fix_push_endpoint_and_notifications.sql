-- ============================================================
-- Fix push endpoint (Bornaal → DeliveryApp) + add missing notifications
-- ============================================================

-- 1. Store DeliveryApp anon key in Vault for push trigger auth
DO $$
BEGIN
  BEGIN
    EXECUTE $v$SELECT vault.create_secret(
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1lYWZ5dmhlZGhoeGJqY3l6Ymx3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzODgxMTUsImV4cCI6MjEwMzk2NDExNX0.iLqTo5es_u9eq1PqXu8JQV8UdL0Bsxp-13qA-It4inw',
      'supabase_anon_key'
    )$v$;
  EXCEPTION WHEN others THEN
    -- Already exists or vault not available — try app.settings fallback
    BEGIN
      EXECUTE $s$ALTER DATABASE postgres SET app.settings.anon_key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1lYWZ5dmhlZGhoeGJqY3l6Ymx3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzODgxMTUsImV4cCI6MjEwMzk2NDExNX0.iLqTo5es_u9eq1PqXu8JQV8UdL0Bsxp-13qA-It4inw'$s$;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Could not set anon key via vault or app.settings: %', SQLERRM;
    END;
  END;
END$$;

-- 2. Fix push_after_notification — point to DeliveryApp project
CREATE OR REPLACE FUNCTION public.push_after_notification()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_key text;
BEGIN
  BEGIN
    v_key := public.get_anon_key();
    PERFORM net.http_post(
      'https://meafyvhedhhxbjcyzblw.supabase.co/functions/v1/push-send',
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
      CASE WHEN v_key <> '' THEN
        jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key)
      ELSE
        jsonb_build_object('Content-Type','application/json')
      END,
      5000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'push_after_notification falhou: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- 3. Fix push_nearby_novidade — point to DeliveryApp project
CREATE OR REPLACE FUNCTION public.push_nearby_novidade()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_key text;
BEGIN
  IF NEW.category IS NULL OR NEW.category = '' OR NEW.location IS NULL OR NEW.location = '' THEN
    RETURN NEW;
  END IF;
  BEGIN
    v_key := public.get_anon_key();
    PERFORM net.http_post(
      'https://meafyvhedhhxbjcyzblw.supabase.co/functions/v1/push-send',
      jsonb_build_object(
        'kind', 'novidades',
        'location', NEW.location,
        'name', NEW.name,
        'category', NEW.category,
        'profile_type', NEW.profile_type,
        'author_user_id', COALESCE(NEW.user_id::text, '')
      ),
      '{}'::jsonb,
      CASE WHEN v_key <> '' THEN
        jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key)
      ELSE
        jsonb_build_object('Content-Type','application/json')
      END,
      5000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'push_nearby_novidade falhou: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- Recreate triggers (idempotent)
DROP TRIGGER IF EXISTS on_notification_created_push ON public.notifications;
CREATE TRIGGER on_notification_created_push
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.push_after_notification();

DROP TRIGGER IF EXISTS on_profiles_insert_novidade ON public.profiles;
CREATE TRIGGER on_profiles_insert_novidade
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.push_nearby_novidade();

-- 4. Add missing delivery notifications for RESTAURANT
-- Current notify_delivery_accepted only notifies customer.
-- Need to also notify restaurant when driver accepts and picks up.
CREATE OR REPLACE FUNCTION public.notify_delivery_accepted()
RETURNS trigger AS $$
DECLARE
  v_customer_id uuid;
  v_business_owner_id uuid;
  v_driver_name text;
  v_order_number integer;
BEGIN
  -- Get order info
  SELECT customer_id, order_number INTO v_customer_id, v_order_number
  FROM public.orders WHERE id = NEW.order_id;

  SELECT name INTO v_driver_name FROM public.drivers WHERE id = NEW.driver_id;

  -- Driver accepted delivery
  IF OLD.status = 'pendente' AND NEW.status = 'aceite' THEN
    -- Notify customer
    IF v_customer_id IS NOT NULL THEN
      PERFORM public.create_notification(
        v_customer_id,
        'Motorista Encontrado!',
        COALESCE(v_driver_name, 'Um motorista') || ' aceitou a sua entrega.',
        'delivery',
        'delivery',
        NEW.id
      );
    END IF;
    -- Notify restaurant owner
    SELECT p.user_id INTO v_business_owner_id
    FROM public.orders o JOIN public.profiles p ON p.id = o.business_id
    WHERE o.id = NEW.order_id;
    IF v_business_owner_id IS NOT NULL THEN
      PERFORM public.create_notification(
        v_business_owner_id,
        'Motorista a caminho — Pedido #' || v_order_number,
        COALESCE(v_driver_name, 'Um motorista') || ' aceitou a entrega e esta a caminho do restaurante.',
        'delivery',
        'order',
        NEW.order_id
      );
    END IF;
  END IF;

  -- Driver picked up the order
  IF OLD.status = 'aceite' AND NEW.status = 'recolhido' THEN
    -- Notify restaurant owner
    SELECT p.user_id INTO v_business_owner_id
    FROM public.orders o JOIN public.profiles p ON p.id = o.business_id
    WHERE o.id = NEW.order_id;
    IF v_business_owner_id IS NOT NULL THEN
      PERFORM public.create_notification(
        v_business_owner_id,
        'Pedido recolhido — #' || v_order_number,
        COALESCE(v_driver_name, 'O motorista') || ' recolheu o pedido e esta a caminho do cliente.',
        'delivery',
        'order',
        NEW.order_id
      );
    END IF;
  END IF;

  -- Delivery completed
  IF OLD.status <> 'entregue' AND NEW.status = 'entregue' THEN
    IF v_customer_id IS NOT NULL THEN
      PERFORM public.create_notification(
        v_customer_id,
        'Pedido Entregue!',
        'A sua entrega foi concluida com sucesso.',
        'delivery',
        'delivery',
        NEW.id
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Recreate trigger
DROP TRIGGER IF EXISTS trg_notify_delivery_status ON public.deliveries;
CREATE TRIGGER trg_notify_delivery_status
  AFTER UPDATE OF status ON public.deliveries
  FOR EACH ROW EXECUTE FUNCTION public.notify_delivery_accepted();
