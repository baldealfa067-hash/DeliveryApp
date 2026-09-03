-- ============================================================
-- Fluxo de denúncias revisto (Prompt 1)
-- - description (texto livre obrigatório)
-- - status: pendente / validada / rejeitada (admin decide)
-- - RLS: só clientes inserem; só admin vê/atualiza
-- - Score de qualidade: só denúncias 'validada' penalizam
-- - Notificação ao prestador quando validada/rejeitada
-- - complaints no supabase_realtime
-- Versão IDEMPOTENTE — pode correr várias vezes (SQL Editor / CLI)
-- ============================================================

-- 1. Coluna description
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS description text;

-- 2. Novo CHECK de status (substitui o antigo)
ALTER TABLE public.complaints DROP CONSTRAINT IF EXISTS complaints_status_check;
ALTER TABLE public.complaints
  ADD CONSTRAINT complaints_status_check
  CHECK (status IN ('pendente', 'validada', 'rejeitada'));

-- 3. RLS — remover políticas antigas
DROP POLICY IF EXISTS "Authenticated can insert complaints" ON public.complaints;
DROP POLICY IF EXISTS "Authenticated can view complaints" ON public.complaints;
DROP POLICY IF EXISTS "Providers can view own complaints" ON public.complaints;

-- 3.1 INSERT: só clientes
DROP POLICY IF EXISTS "Clients can insert complaints" ON public.complaints;
CREATE POLICY "Clients can insert complaints" ON public.complaints
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'client'));

-- 3.2 SELECT: só admin
DROP POLICY IF EXISTS "Admins can view complaints" ON public.complaints;
CREATE POLICY "Admins can view complaints" ON public.complaints
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 3.3 UPDATE: só admin
DROP POLICY IF EXISTS "Admins can update complaints" ON public.complaints;
CREATE POLICY "Admins can update complaints" ON public.complaints
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 4. Score: só 'validada' penaliza
CREATE OR REPLACE FUNCTION public.calculate_quality_score(p_provider_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_score integer;
  v_reviews_positive integer;
  v_complaints integer;
BEGIN
  SELECT count(*) INTO v_reviews_positive
  FROM public.reviews
  WHERE provider_id = p_provider_id AND rating >= 4;

  SELECT count(*) INTO v_complaints
  FROM public.complaints
  WHERE provider_id = p_provider_id AND status = 'validada';

  v_score := v_reviews_positive - v_complaints;
  RETURN v_score;
END;
$$;

-- 5. Recalcular qualidade também quando o admin muda o status
DROP TRIGGER IF EXISTS update_quality_after_complaint_status ON public.complaints;
CREATE TRIGGER update_quality_after_complaint_status
  AFTER UPDATE OF status ON public.complaints
  FOR EACH ROW EXECUTE FUNCTION public.update_quality_level();

-- 6. Notificar o prestador quando a denúncia é validada/rejeitada
CREATE OR REPLACE FUNCTION public.notify_provider_on_complaint_status()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  IF NEW.status IN ('validada', 'rejeitada') THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      NEW.provider_id,
      'denuncia_' || NEW.status,
      CASE WHEN NEW.status = 'validada'
        THEN 'Denúncia confirmada'
        ELSE 'Denúncia arquivada'
      END,
      CASE WHEN NEW.status = 'validada'
        THEN 'Recebemos uma denúncia contra si e, após análise, foi confirmada pela nossa equipa.'
        ELSE 'A denúncia contra si foi analisada e não foi confirmada. Obrigado.'
      END,
      '/perfil'
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_complaint_status_changed ON public.complaints;
CREATE TRIGGER on_complaint_status_changed
  AFTER UPDATE OF status ON public.complaints
  FOR EACH ROW EXECUTE FUNCTION public.notify_provider_on_complaint_status();

-- 7. Realtime (admin vê denúncias novas em tempo real)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'complaints'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.complaints;
  END IF;
END $$;