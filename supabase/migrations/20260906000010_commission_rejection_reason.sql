-- Allow admin to add rejection reason when rejecting commission payments

-- Update the validate_commission_payment RPC to accept a note parameter
DROP FUNCTION IF EXISTS public.validate_commission_payment(uuid, text);

CREATE OR REPLACE FUNCTION public.validate_commission_payment(p_id uuid, p_status text, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Apenas administradores';
  END IF;
  IF p_status NOT IN ('validado', 'rejeitado') THEN
    RAISE EXCEPTION 'Estado invalido';
  END IF;
  UPDATE public.commission_payments
  SET status = p_status, validated_at = now(), validated_by = auth.uid(), note = CASE WHEN p_status = 'rejeitado' THEN p_note ELSE note END
  WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_commission_payment(uuid, text, text) TO authenticated;
