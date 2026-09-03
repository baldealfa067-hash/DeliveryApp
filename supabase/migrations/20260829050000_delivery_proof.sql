-- ============================================================
-- Etapa 7: QR Code + Comprovativo Fotográfico
-- ============================================================

-- 1. Tabela de comprovativos de entrega
CREATE TABLE IF NOT EXISTS public.delivery_proofs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  delivery_id uuid NOT NULL REFERENCES public.deliveries(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id),
  photo_url text,
  qr_validated boolean DEFAULT false NOT NULL,
  validated_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.delivery_proofs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Delivery proofs viewable by involved"
ON public.delivery_proofs FOR SELECT
TO public
USING (
  driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
  OR order_id IN (
    SELECT id FROM public.orders
    WHERE customer_id = auth.uid()
       OR business_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  )
  OR public.has_role(auth.uid(), 'admin')
);

GRANT SELECT ON public.delivery_proofs TO authenticated;
GRANT ALL ON public.delivery_proofs TO service_role;

-- 2. RPC: Criar comprovativo de entrega
CREATE OR REPLACE FUNCTION public.create_delivery_proof(
  p_delivery_id uuid,
  p_photo_url text,
  p_qr_validated boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_proof_id uuid;
  v_order_id uuid;
  v_driver_id uuid;
BEGIN
  -- Verify driver owns this delivery
  SELECT d.order_id, d.driver_id INTO v_order_id, v_driver_id
  FROM public.deliveries d
  WHERE d.id = p_delivery_id
    AND d.driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
    AND d.status IN ('recolhido', 'em_entrega');

  IF v_driver_id IS NULL THEN RAISE EXCEPTION 'Entrega não encontrada ou sem permissão'; END IF;

  INSERT INTO public.delivery_proofs (delivery_id, order_id, driver_id, photo_url, qr_validated, validated_at)
  VALUES (p_delivery_id, v_order_id, v_driver_id, p_photo_url, p_qr_validated,
          CASE WHEN p_qr_validated THEN now() ELSE NULL END)
  RETURNING id INTO v_proof_id;

  -- If QR validated, auto-complete delivery
  IF p_qr_validated THEN
    PERFORM public.complete_delivery(p_delivery_id);
  END IF;

  RETURN v_proof_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_delivery_proof(uuid, text, boolean) TO authenticated;

-- 3. RPC: Validar QR Code
CREATE OR REPLACE FUNCTION public.validate_delivery_qr(
  p_delivery_id uuid,
  p_order_id uuid
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Verify the delivery and order match, and driver owns it
  IF EXISTS (
    SELECT 1 FROM public.deliveries d
    WHERE d.id = p_delivery_id
      AND d.order_id = p_order_id
      AND d.driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
  ) THEN
    UPDATE public.delivery_proofs
    SET qr_validated = true, validated_at = now()
    WHERE delivery_id = p_delivery_id;
    RETURN true;
  END IF;
  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_delivery_qr(uuid, uuid) TO authenticated;
