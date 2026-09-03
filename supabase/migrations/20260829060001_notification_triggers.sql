-- ============================================================
-- Triggers para Notificações Automáticas
-- ============================================================

-- 1. Notificação quando novo pedido é criado
CREATE OR REPLACE FUNCTION public.notify_new_order()
RETURNS trigger AS $$
DECLARE
  v_owner_id uuid;
BEGIN
  -- Get business owner
  SELECT user_id INTO v_owner_id FROM public.profiles WHERE id = NEW.business_id;
  IF v_owner_id IS NOT NULL AND v_owner_id <> NEW.customer_id THEN
    PERFORM public.create_notification(
      v_owner_id,
      'Novo Pedido #' || NEW.order_number,
      NEW.customer_name || ' fez um pedido de ' || NEW.total || ' FCFA',
      'order',
      'order',
      NEW.id
    );
  END IF;
  -- Notify customer
  IF NEW.customer_id IS NOT NULL THEN
    PERFORM public.create_notification(
      NEW.customer_id,
      'Pedido #' || NEW.order_number || ' Criado',
      'O seu pedido foi recebido pelo restaurante.',
      'order',
      'order',
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_notify_new_order
  AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.notify_new_order();

-- 2. Notificação quando status do pedido muda
CREATE OR REPLACE FUNCTION public.notify_order_status_change()
RETURNS trigger AS $$
DECLARE
  v_customer_id uuid;
  v_business_name text;
  v_status_label text;
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  v_customer_id := NEW.customer_id;
  SELECT name INTO v_business_name FROM public.businesses WHERE id = NEW.business_id;

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
    PERFORM public.create_notification(
      v_customer_id,
      'Pedido #' || NEW.order_number || ' - ' || v_status_label,
      COALESCE(v_business_name, 'O restaurante') || ' atualizou o estado do seu pedido.',
      'order',
      'order',
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_notify_order_status
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.notify_order_status_change();

-- 3. Notificação quando agendamento é criado
CREATE OR REPLACE FUNCTION public.notify_new_appointment()
RETURNS trigger AS $$
DECLARE
  v_owner_id uuid;
  v_service_name text;
BEGIN
  SELECT user_id INTO v_owner_id FROM public.profiles WHERE id = NEW.business_id;
  SELECT name INTO v_service_name FROM public.services WHERE id = NEW.service_id;

  IF v_owner_id IS NOT NULL AND v_owner_id <> NEW.customer_id THEN
    PERFORM public.create_notification(
      v_owner_id,
      'Novo Agendamento',
      NEW.customer_name || ' agendou ' || COALESCE(v_service_name, 'um serviço'),
      'appointment',
      'appointment',
      NEW.id
    );
  END IF;

  IF NEW.customer_id IS NOT NULL THEN
    PERFORM public.create_notification(
      NEW.customer_id,
      'Agendamento Criado',
      'O seu agendamento foi recebido. Aguarde confirmação.',
      'appointment',
      'appointment',
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_notify_new_appointment
  AFTER INSERT ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.notify_new_appointment();

-- 4. Notificação quando status do agendamento muda
CREATE OR REPLACE FUNCTION public.notify_appointment_status_change()
RETURNS trigger AS $$
DECLARE
  v_customer_id uuid;
  v_status_label text;
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  v_customer_id := NEW.customer_id;
  v_status_label := CASE NEW.status
    WHEN 'confirmado' THEN 'Confirmado'
    WHEN 'em_atendimento' THEN 'Em atendimento'
    WHEN 'concluido' THEN 'Concluído'
    WHEN 'cancelado' THEN 'Cancelado'
    ELSE NEW.status
  END;

  IF v_customer_id IS NOT NULL THEN
    PERFORM public.create_notification(
      v_customer_id,
      'Agendamento - ' || v_status_label,
      'O estado do seu agendamento foi atualizado.',
      'appointment',
      'appointment',
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_notify_appointment_status
  AFTER UPDATE OF status ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.notify_appointment_status_change();

-- 5. Notificação quando entrega é aceite
CREATE OR REPLACE FUNCTION public.notify_delivery_accepted()
RETURNS trigger AS $$
DECLARE
  v_customer_id uuid;
  v_driver_name text;
BEGIN
  IF OLD.status = 'pendente' AND NEW.status = 'aceite' THEN
    v_customer_id := (SELECT customer_id FROM public.orders WHERE id = NEW.order_id);
    SELECT name INTO v_driver_name FROM public.drivers WHERE id = NEW.driver_id;

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
  END IF;

  IF OLD.status <> 'entregue' AND NEW.status = 'entregue' THEN
    v_customer_id := (SELECT customer_id FROM public.orders WHERE id = NEW.order_id);
    IF v_customer_id IS NOT NULL THEN
      PERFORM public.create_notification(
        v_customer_id,
        'Pedido Entregue!',
        'A sua entrega foi concluída com sucesso.',
        'delivery',
        'delivery',
        NEW.id
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_notify_delivery_status
  AFTER UPDATE OF status ON public.deliveries
  FOR EACH ROW EXECUTE FUNCTION public.notify_delivery_accepted();
