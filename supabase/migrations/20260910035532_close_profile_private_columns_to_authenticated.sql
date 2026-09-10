-- Fechar as colunas privadas de `profiles` a QUALQUER conta autenticada.
--
-- A Fase 1 fechou-as ao anonimo e deixou registado, duas vezes, que continuavam
-- legiveis por qualquer autenticado. Um restaurante conseguia ler o codigo de
-- comerciante de outro; pior, qualquer conta conseguia ler os documentos de
-- identidade e as selfies de verificacao de toda a gente com uma so' query.
--
-- AS ESCRITAS JA' ESTAVAM PROTEGIDAS desde 20260907092528 (trigger
-- protect_profile_verification). O que faltava era a LEITURA.
--
-- OS DOIS GRUPOS NAO TEM A MESMA NATUREZA, e por isso nao levam a mesma regra:
--
--   merchant_code / payment_number  -- NAO sao segredo do dono. §23 diz que o
--     cliente usa estes dados para pagar por Orange Money, portanto um cliente
--     com sessao TEM de os ver, do negocio a que esta' a comprar. O que nao pode
--     e' qualquer conta descarregar a lista inteira de uma vez. Passam a sair
--     por RPC, um negocio de cada vez.
--
--   verification_doc_url / verification_selfie_url / verification_reason -- sao
--     documentos de identidade. Nao ha caso de uso legitimo para terceiros.
--     So' o proprio e o admin.
--
-- NOTA: o REVOKE por coluna abaixo NAO teve efeito -- ver a migracao seguinte,
-- 20260910035702, que explica porque e faz o que era preciso. Mantem-se aqui
-- como correu (§56); as RPCs que esta migracao cria e' que sao o essencial.

REVOKE SELECT (merchant_code, payment_number, verification_doc_url,
               verification_selfie_url, verification_reason)
  ON public.profiles FROM authenticated, anon;

-- ---------------------------------------------------------------------------
-- §23: o cliente com sessao ve' os dados de pagamento do negocio a que compra.
-- Um negocio de cada vez -- e' o que mata a enumeracao em massa.
CREATE OR REPLACE FUNCTION public.get_business_payment_info(p_business_id uuid)
RETURNS TABLE (merchant_code text, payment_number text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sem sessao';
  END IF;
  RETURN QUERY
  SELECT p.merchant_code, p.payment_number
  FROM public.profiles p WHERE p.id = p_business_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- O dono le' as suas proprias colunas privadas. Nao aceita id nenhum de fora:
-- resolve sempre pelo auth.uid() de quem chama, portanto nao ha parametro
-- para manipular.
CREATE OR REPLACE FUNCTION public.get_my_profile_private()
RETURNS TABLE (merchant_code text, payment_number text,
               verification_doc_url text, verification_selfie_url text,
               verification_reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sem sessao';
  END IF;
  RETURN QUERY
  SELECT p.merchant_code, p.payment_number,
         p.verification_doc_url, p.verification_selfie_url, p.verification_reason
  FROM public.profiles p WHERE p.user_id = auth.uid();
END;
$$;

-- ---------------------------------------------------------------------------
-- O admin modera a fila de verificacao (§55). So' as colunas de KYC: os dados
-- de pagamento nao entram, porque moderar documentos nao precisa deles.
CREATE OR REPLACE FUNCTION public.admin_list_verifications()
RETURNS TABLE (profile_id uuid, verification_doc_url text,
               verification_selfie_url text, verification_reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Apenas administradores';
  END IF;
  RETURN QUERY
  SELECT p.id, p.verification_doc_url, p.verification_selfie_url, p.verification_reason
  FROM public.profiles p;
END;
$$;

-- A regra de 20260910033308: revogar dos DOIS.
REVOKE EXECUTE ON FUNCTION public.get_business_payment_info(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_my_profile_private()       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_verifications()     FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_business_payment_info(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_profile_private()        TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_verifications()      TO authenticated;
