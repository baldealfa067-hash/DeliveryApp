CREATE TABLE public.delivery_confirmation_pins (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  pin text NOT NULL CHECK (pin ~ '^[0-9]{4}$')
);
ALTER TABLE public.delivery_confirmation_pins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.delivery_confirmation_pins FROM PUBLIC, anon, authenticated;
ALTER TABLE public.delivery_proofs ADD COLUMN code_validated_at timestamptz;

CREATE FUNCTION public.get_delivery_confirmation_pin(p_order_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_pin text;
  v_random bytea;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.orders o WHERE o.id = p_order_id AND o.consumption_option = 'entrega'
      AND o.status IN ('motorista_encontrado', 'pedido_recolhido', 'a_caminho')
      AND (o.customer_id = auth.uid() OR (
        o.customer_id IS NULL AND o.source = 'manual'
        AND public.is_business_owner(o.business_id)
      ))
  ) THEN RETURN NULL; END IF;

  SELECT pin INTO v_pin FROM public.delivery_confirmation_pins WHERE order_id = p_order_id;
  IF FOUND THEN RETURN v_pin; END IF;

  -- Reject the tail rather than introducing modulo bias.
  LOOP
    v_random := extensions.gen_random_bytes(2);
    EXIT WHEN get_byte(v_random, 0) * 256 + get_byte(v_random, 1) < 60000;
  END LOOP;
  INSERT INTO public.delivery_confirmation_pins(order_id, pin)
  VALUES (p_order_id, lpad(((get_byte(v_random, 0) * 256 + get_byte(v_random, 1)) % 10000)::text, 4, '0'))
  ON CONFLICT (order_id) DO NOTHING;
  SELECT pin INTO v_pin FROM public.delivery_confirmation_pins WHERE order_id = p_order_id;
  RETURN v_pin;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_delivery_code(p_delivery_id uuid, p_code text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_delivery public.deliveries%ROWTYPE;
  v_pin text;
BEGIN
  SELECT o.* INTO v_order FROM public.orders o
  JOIN public.deliveries d ON d.order_id = o.id
  JOIN public.drivers dr ON dr.id = d.driver_id
  WHERE d.id = p_delivery_id AND dr.user_id = auth.uid()
  FOR UPDATE OF o;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT d.* INTO v_delivery FROM public.deliveries d
  JOIN public.drivers dr ON dr.id = d.driver_id
  WHERE d.id = p_delivery_id AND dr.user_id = auth.uid()
  FOR UPDATE OF d;
  IF NOT FOUND THEN RETURN false; END IF;

  IF v_order.status = 'concluido' AND v_delivery.status = 'entregue' THEN
    RETURN EXISTS (SELECT 1 FROM public.delivery_proofs p
      WHERE p.delivery_id = p_delivery_id AND p.driver_id = v_delivery.driver_id AND p.code_validated_at IS NOT NULL);
  END IF;
  IF v_order.consumption_option <> 'entrega'
    OR v_order.status NOT IN ('pedido_recolhido', 'a_caminho')
    OR v_delivery.status NOT IN ('recolhido', 'em_entrega')
    OR p_code IS NULL OR p_code !~ '^[0-9]{4}$' THEN RETURN false; END IF;

  IF v_delivery.code_attempts >= 5 THEN
    RAISE EXCEPTION 'Código bloqueado após cinco tentativas. Contacta o suporte.';
  END IF;

  SELECT pin INTO v_pin FROM public.delivery_confirmation_pins WHERE order_id = v_order.id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_pin <> p_code THEN
    UPDATE public.deliveries SET code_attempts = code_attempts + 1 WHERE id = p_delivery_id;
    RETURN false;
  END IF;

  INSERT INTO public.delivery_proofs (delivery_id, order_id, driver_id, stage, code_validated_at)
  VALUES (p_delivery_id, v_order.id, v_delivery.driver_id, 'delivery', now());
  PERFORM public.complete_delivery(p_delivery_id);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_exige_prova_de_entrega()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_stage text;
BEGIN
  IF NEW.consumption_option <> 'entrega' OR OLD.status = NEW.status
    OR auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  v_stage := CASE
    WHEN NEW.status = 'concluido' THEN 'delivery'
    WHEN NEW.status IN ('pedido_recolhido', 'a_caminho') THEN 'pickup'
  END;
  IF v_stage IS NOT NULL AND NOT EXISTS (
    SELECT FROM public.delivery_proofs p
    JOIN public.deliveries d ON d.id = p.delivery_id AND d.driver_id = p.driver_id
    WHERE p.order_id = NEW.id AND d.order_id = NEW.id AND p.stage = v_stage
      AND ((v_stage = 'delivery' AND p.code_validated_at IS NOT NULL)
        OR (v_stage = 'pickup' AND p.gps_verified_at IS NOT NULL AND p.photo_url IS NOT NULL))
  ) THEN
    RAISE EXCEPTION 'Confirma esta etapa no painel do motorista.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_order_photo_proof(p_order_id uuid, p_stage text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT jsonb_build_object('existe', true, 'tipo', CASE WHEN pr.code_validated_at IS NULL THEN 'foto' ELSE 'codigo' END,
    'foto', pr.photo_url, 'registada_em', coalesce(pr.code_validated_at, pr.gps_verified_at, pr.created_at))
  FROM public.orders o
  JOIN public.delivery_proofs pr ON pr.order_id = o.id
  WHERE o.id = p_order_id AND pr.stage = p_stage
    AND (pr.photo_url IS NOT NULL OR pr.code_validated_at IS NOT NULL)
    AND (p_stage = 'pickup' AND o.customer_id = auth.uid()
      OR p_stage = 'delivery' AND (public.is_business_owner(o.business_id) OR o.customer_id = auth.uid())
      OR public.has_role(auth.uid(), 'admin'))
  ORDER BY (pr.code_validated_at IS NOT NULL) DESC, pr.created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_delivery_confirmation_pin(uuid), public.validate_delivery_code(uuid,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_delivery_confirmation_pin(uuid), public.validate_delivery_code(uuid,text)
  TO authenticated;
