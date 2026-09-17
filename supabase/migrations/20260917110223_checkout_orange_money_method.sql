-- Checkout, ponto 3 (2026-09-17) — o restaurante ESCOLHE como recebe por Orange Money.
--
-- Até aqui havia dois campos soltos e o checkout decidia sozinho (código se
-- existisse, senão número). Agora o dono escolhe:
--   'codigo'  código de comerciante USSD — o cliente toca e o pagamento abre
--   'numero'  número normal — o cliente copia e transfere à mão
--   NULL      não recebe por Orange Money (só dinheiro na entrega)
--
-- Os dois valores continuam guardados; o método decide qual sai para o cliente.
-- Coluna PRIVADA, como merchant_code/payment_number: fica fora do GRANT SELECT por
-- coluna de 20260910035702, portanto nem anon nem authenticated a lêem directamente.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS orange_money_method text;

-- Migração: preserva o que o checkout já mostrava a cada restaurante.
UPDATE public.profiles
SET orange_money_method = CASE
  WHEN NULLIF(btrim(merchant_code), '') IS NOT NULL THEN 'codigo'
  WHEN NULLIF(btrim(payment_number), '') IS NOT NULL THEN 'numero'
END
WHERE orange_money_method IS NULL;

-- §46: a coerência vive na base, não só no formulário.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_orange_money_method_coerente;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_orange_money_method_coerente CHECK (
  orange_money_method IS NULL
  OR (orange_money_method = 'codigo' AND NULLIF(btrim(merchant_code), '') IS NOT NULL)
  OR (orange_money_method = 'numero' AND NULLIF(btrim(payment_number), '') IS NOT NULL)
);

-- O cliente recebe SÓ o do método escolhido. Mesma forma de retorno: o checkout
-- continua a ler merchant_code/payment_number, e um deles vem sempre NULL.
CREATE OR REPLACE FUNCTION public.get_business_payment_info(p_business_id uuid)
RETURNS TABLE (merchant_code text, payment_number text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sem sessao';
  END IF;
  RETURN QUERY
  SELECT
    CASE WHEN p.orange_money_method = 'codigo' THEN NULLIF(btrim(p.merchant_code), '') END,
    CASE WHEN p.orange_money_method = 'numero' THEN NULLIF(btrim(p.payment_number), '') END
  FROM public.profiles p WHERE p.id = p_business_id;
END;
$$;

-- O dono precisa de ler o método para o formulário. Mudar o RETURNS TABLE obriga a
-- DROP + CREATE; os GRANT voltam no fim.
DROP FUNCTION IF EXISTS public.get_my_profile_private();
CREATE FUNCTION public.get_my_profile_private()
RETURNS TABLE (merchant_code text, payment_number text,
               verification_doc_url text, verification_selfie_url text,
               verification_reason text, orange_money_method text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sem sessao';
  END IF;
  RETURN QUERY
  SELECT p.merchant_code, p.payment_number,
         p.verification_doc_url, p.verification_selfie_url, p.verification_reason,
         p.orange_money_method
  FROM public.profiles p WHERE p.user_id = auth.uid();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_business_payment_info(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_business_payment_info(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_my_profile_private()        FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_my_profile_private()        TO authenticated;
