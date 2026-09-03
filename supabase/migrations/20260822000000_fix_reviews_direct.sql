-- ============================================================
-- Fix: avaliações diretas (sem pedido) + negócios
-- PROBLEMA: trigger e RLS exigiam request_id NOT NULL, bloqueando
-- avaliações diretas no perfil (ProviderDetail/BusinessDetail) e
-- avaliações de negócios/restaurantes que não usam service_requests.
-- Antes (pre-20260817040000) qualquer utilizador autenticado podia
-- avaliar diretamente; o fluxo novo via Pedidos deve continuar válido
-- mas não deve quebrar o fluxo direto.
-- SOLUÇÃO: permitir request_id NULL para avaliações diretas;
-- quando request_id é fornecido, validar concluído + bid aceite.
-- Quando é NULL, apenas verificar que o provider existe.
-- Também permitir que o autor veja a sua própria pendente (para
-- return=representation) e que negócios sejam avaliáveis.
-- ============================================================

-- 1. RLS INSERT: permitir request_id NULL (mas ainda exigir auth)
DROP POLICY IF EXISTS "Authenticated can insert reviews" ON public.reviews;
CREATE POLICY "Authenticated can insert reviews" ON public.reviews
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
  );

-- 2. Trigger: permitir NULL e validar apenas quando há request_id
CREATE OR REPLACE FUNCTION public.validate_review_insert()
RETURNS TRIGGER AS $$
DECLARE
  req_status text;
  has_accepted boolean;
  prov_type text;
BEGIN
  -- Se não há pedido associado -> avaliação direta: permitir
  -- (usado em ProviderDetail/BusinessDetail sem fluxo de Pedidos)
  IF NEW.request_id IS NULL THEN
    -- Garantir que o provider existe
    SELECT profile_type INTO prov_type FROM public.profiles WHERE id = NEW.provider_id;
    IF prov_type IS NULL THEN
      RAISE EXCEPTION 'Prestador/negócio não encontrado';
    END IF;
    RETURN NEW;
  END IF;

  -- Se há request_id -> validar regras do fluxo Pedidos
  SELECT status INTO req_status
  FROM public.service_requests WHERE id = NEW.request_id;

  IF req_status IS DISTINCT FROM 'concluido' THEN
    RAISE EXCEPTION 'Só é possível avaliar após o serviço ser marcado como concluído';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.request_bids
    WHERE request_id = NEW.request_id
      AND provider_id = NEW.provider_id
      AND status = 'aceite'
  ) INTO has_accepted;

  IF NOT has_accepted THEN
    RAISE EXCEPTION 'Só pode avaliar um prestador com candidatura aceite neste pedido';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_review_insert_validate ON public.reviews;
CREATE TRIGGER on_review_insert_validate
  BEFORE INSERT ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.validate_review_insert();

-- 3. SELECT: permitir que o autor veja a sua própria avaliação pendente
-- (necessário para return=representation funcionar no JS)
DROP POLICY IF EXISTS "Users can view own reviews" ON public.reviews;
CREATE POLICY "Users can view own reviews" ON public.reviews
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- 4. Remover constraint UNIQUE que impedia múltiplas diretas? Manter
-- UNIQUE (request_id, provider_id) só faz sentido quando request_id NOT NULL.
-- Para avaliações diretas (request_id NULL), múltiplas avaliações do
-- mesmo user para o mesmo provider devem ser permitidas? Manter como está:
-- NULL não viola UNIQUE, então já permite múltiplas diretas.
-- Nada a fazer.

-- 5. Nota: o status 'concluido' já é validado no trigger
