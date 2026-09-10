-- RENUMERADA de 20260906000010 para 20260909222000 em 2026-09-10.
--
-- PORQUE: partilhava o numero 20260906000010 com merchant_code.sql. Duas
-- migracoes com a mesma versao -- a CLI so' consegue registar uma, deu a outra
-- por aplicada, e esta ficou por aplicar sem ninguem dar por isso. A data de
-- 6 de Setembro era ficcao: nunca chegou ao servidor. Passa para depois de tudo
-- o que esta' aplicado, que e' onde ela de facto vai correr.
--
-- CONSEQUENCIA REAL que isto deixou em producao: useCommission.ts:116 chama
-- validate_commission_payment com `p_note`, mas a funcao viva so' aceita
-- (p_id, p_status). Rejeitar um pagamento de comissao com motivo falha --
-- a RPC nem sequer e' encontrada. Esta migracao e' a correccao desse bug.

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

-- DROP + CREATE faz nascer uma funcao NOVA, e uma funcao nova traz EXECUTE
-- para PUBLIC por omissao. Sem este REVOKE, esta migracao desfazia em silencio
-- a correccao de 20260909213622 para esta funcao -- que e' precisamente a
-- armadilha que essa migracao documenta.
REVOKE EXECUTE ON FUNCTION public.validate_commission_payment(uuid, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.validate_commission_payment(uuid, text, text) TO authenticated;
