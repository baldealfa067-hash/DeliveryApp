-- ============================================================
-- Avaliação só após serviço concluído — versão IDEMPOTENTE
-- Pode correr várias vezes sem erro (SQL Editor do dashboard)
-- ============================================================

-- 1. Coluna request_id na tabela reviews (liga avaliação ao pedido)
DO $$ BEGIN
  ALTER TABLE public.reviews ADD COLUMN request_id uuid REFERENCES public.service_requests(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- 2. Índice e constraint UNIQUE: só 1 review por pedido por prestador
DO $$ BEGIN
  ALTER TABLE public.reviews ADD CONSTRAINT reviews_request_provider_unique
    UNIQUE (request_id, provider_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. Política INSERT: exigir autenticação e user_id = auth.uid()
DROP POLICY IF EXISTS "Public can insert reviews" ON public.reviews;
DROP POLICY IF EXISTS "Authenticated can insert reviews" ON public.reviews;
CREATE POLICY "Authenticated can insert reviews" ON public.reviews
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND request_id IS NOT NULL
  );

-- 4. Função de validação: só permite review se o pedido está "concluido"
--    e o prestador tem uma candidatura aceite nesse pedido.
CREATE OR REPLACE FUNCTION public.validate_review_insert()
RETURNS TRIGGER AS $$
DECLARE
  req_status text;
  has_accepted boolean;
BEGIN
  IF NEW.request_id IS NULL THEN
    RAISE EXCEPTION 'request_id é obrigatório para novas avaliações';
  END IF;

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

-- 5. Função para marcar pedido como concluído (só o dono pode fazer)
CREATE OR REPLACE FUNCTION public.mark_request_completed(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.service_requests
  SET status = 'concluido'
  WHERE id = p_request_id
    AND user_id = auth.uid()
    AND status != 'concluido';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido não encontrado ou sem permissão';
  END IF;
END;
$$;

-- 6. Nota: o status 'concluido' não precisa de CHECK constraint
--    porque a tabela service_requests não tem CHECK no status.
