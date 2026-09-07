-- As politicas de UPDATE de profiles permitem ao dono alterar qualquer coluna do
-- seu proprio perfil — incluindo is_verified e verification_status. Ou seja,
-- qualquer utilizador podia atribuir-se o selo de verificado.
--
-- Correcao aditiva (nao mexe em politicas): um trigger que repoe as colunas de
-- verificacao se quem edita nao for admin. A submissao para analise continua a
-- funcionar; a aprovacao passa a ser exclusiva do admin.
--
-- Optou-se por trigger em vez de endurecer a politica de UPDATE porque a
-- politica restritiva que ja existia bloqueava o dono de editar a propria loja
-- (morada, numero de pagamento, tempo de preparacao) assim que fosse aprovado —
-- nao e essa a intencao.
CREATE OR REPLACE FUNCTION public.protect_profile_verification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- service_role e funcoes internas (auth.uid() nulo) e admins passam sem tocar.
  -- O anon nunca chega aqui: a politica de UPDATE exige auth.uid() = user_id.
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  -- Ninguem se auto-verifica nem escreve o motivo da decisao.
  NEW.is_verified         := OLD.is_verified;
  NEW.verification_reason := OLD.verification_reason;

  -- Submeter para analise ('none'/'rejeitado' -> 'pendente') e permitido.
  -- Qualquer outra transicao feita pelo proprio e revertida.
  IF NEW.verification_status IS DISTINCT FROM OLD.verification_status
     AND NOT (NEW.verification_status = 'pendente'
              AND COALESCE(OLD.verification_status, 'none') IN ('none', 'rejeitado')) THEN
    NEW.verification_status := OLD.verification_status;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_protect_profile_verification ON public.profiles;
CREATE TRIGGER trg_protect_profile_verification
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_verification();
