-- ============================================================
-- Avaliações anónimas — visitantes podem avaliar sem criar conta
-- - user_id passa a ser opcional (NULL = anónimo)
-- - Anónimos: força status='pendente' (moderação obrigatória) e
--   user_id=NULL (não é possível forjar autoria)
-- - Anti-spam server-side: máx 5 avaliações anónimas pendentes por
--   prestador/negócio em 24h (o admin aprova ou elimina entretanto)
-- - Autenticados: fluxo atual intacto (user_id próprio, validação de
--   pedido concluído com candidatura aceite quando request_id dado)
-- Versão IDEMPOTENTE — pode correr várias vezes (SQL Editor / CLI)
-- ============================================================

-- 1. user_id passa a ser opcional (avaliação anónima)
ALTER TABLE public.reviews ALTER COLUMN user_id DROP NOT NULL;

-- 2. Política de inserção anónima: só linhas sem autor atribuída
--    (a própria policy é verificada DEPOIS do trigger, que força
--    user_id=NULL e status='pendente' nos anónimos)
DROP POLICY IF EXISTS "Anonymous can insert reviews" ON public.reviews;
CREATE POLICY "Anonymous can insert reviews" ON public.reviews
  FOR INSERT TO anon
  WITH CHECK (user_id IS NULL);

GRANT INSERT ON public.reviews TO anon;

-- 3. Trigger único: anon vira pendente + anti-spam; autenticados como antes
CREATE OR REPLACE FUNCTION public.validate_review_insert()
RETURNS TRIGGER AS $$
DECLARE
  req_status text;
  has_accepted boolean;
  prov_type text;
  anon_recent integer;
BEGIN
  IF auth.uid() IS NULL THEN
    -- Avaliação anónima: sem autoria possível e sempre para moderação
    NEW.user_id := NULL;
    NEW.status := 'pendente';

    SELECT COUNT(*) INTO anon_recent
    FROM public.reviews
    WHERE provider_id = NEW.provider_id
      AND user_id IS NULL
      AND status = 'pendente'
      AND created_at > now() - interval '24 hours';

    IF anon_recent >= 5 THEN
      RAISE EXCEPTION 'Muitas avaliações anónimas recentes para este negócio. Tenta novamente mais tarde.';
    END IF;
  ELSIF NEW.user_id IS NULL THEN
    NEW.user_id := auth.uid();
  ELSIF NEW.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Não é possível avaliar em nome de outro utilizador';
  END IF;

  -- Se não há pedido associado -> avaliação direta: permitir
  -- (usado em ProviderDetail/BusinessDetail/BeautyDetail)
  IF NEW.request_id IS NULL THEN
    SELECT profile_type INTO prov_type FROM public.profiles WHERE id = NEW.provider_id;
    IF prov_type IS NULL THEN
      RAISE EXCEPTION 'Prestador/negócio não encontrado';
    END IF;
    RETURN NEW;
  END IF;

  -- Com request_id -> validar regras do fluxo Pedidos
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
