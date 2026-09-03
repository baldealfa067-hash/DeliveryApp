-- FIX: Confirmar pedido falhava com "relation public.businesses does not exist"
-- DeliveryApp usa profiles (profile_type='business') para restaurantes, não tabela businesses
-- Trigger notify_order_status_change fazia SELECT FROM businesses e abortava o UPDATE

CREATE OR REPLACE FUNCTION public.notify_order_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_customer_id uuid;
  v_business_name text;
  v_status_label text;
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  v_customer_id := NEW.customer_id;
  -- DeliveryApp: restaurantes são profiles com profile_type business
  BEGIN
    SELECT name INTO v_business_name FROM public.profiles WHERE id = NEW.business_id;
  EXCEPTION WHEN others THEN
    v_business_name := NULL;
  END;
  -- Fallback para caso ainda exista tabela businesses em instalações antigas
  IF v_business_name IS NULL THEN
    BEGIN
      SELECT name INTO v_business_name FROM public.businesses WHERE id = NEW.business_id;
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;

  v_status_label := CASE NEW.status
    WHEN 'confirmado' THEN 'Confirmado'
    WHEN 'em_preparacao' THEN 'Em preparação'
    WHEN 'pronto' THEN 'Pronto'
    WHEN 'a_caminho' THEN 'A caminho'
    WHEN 'entregue' THEN 'Entregue'
    WHEN 'concluido' THEN 'Concluído'
    WHEN 'cancelado' THEN 'Cancelado'
    ELSE NEW.status
  END;

  IF v_customer_id IS NOT NULL THEN
    BEGIN
      PERFORM public.create_notification(
        v_customer_id,
        'Pedido #' || NEW.order_number || ' - ' || v_status_label,
        COALESCE(v_business_name, 'O restaurante') || ' atualizou o estado do seu pedido.',
        'order',
        'order',
        NEW.id
      );
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'notify_order_status_change notification failed: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'notify_order_status_change failed: %', SQLERRM;
  RETURN NEW;
END;
$function$;

-- Garantir trigger existe e não bloqueia o UPDATE mesmo se falhar
DROP TRIGGER IF EXISTS on_order_status_change ON public.orders;
CREATE TRIGGER on_order_status_change
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.notify_order_status_change();
