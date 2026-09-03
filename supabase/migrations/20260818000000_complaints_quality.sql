-- Sistema de reclamações e nível de qualidade do prestador
-- ============================================================

-- 1. Tabela de reclamações (denúncias)
CREATE TABLE IF NOT EXISTS public.complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovada', 'resolvida')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

GRANT SELECT ON public.complaints TO anon, authenticated;
GRANT ALL ON public.complaints TO service_role;

ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;

-- Policy: authenticated users can insert complaints (clients denouncing providers)
DROP POLICY IF EXISTS "Authenticated can insert complaints" ON public.complaints;
CREATE POLICY "Authenticated can insert complaints" ON public.complaints
  FOR INSERT TO authenticated WITH CHECK (true);

-- Policy: authenticated users can view complaints (admin and the provider involved)
DROP POLICY IF EXISTS "Authenticated can view complaints" ON public.complaints;
CREATE POLICY "Authenticated can view complaints" ON public.complaints
  FOR SELECT TO authenticated USING (true);

-- Policy: providers can view their own complaints
DROP POLICY IF EXISTS "Providers can view own complaints" ON public.complaints;
CREATE POLICY "Providers can view own complaints" ON public.complaints
  FOR SELECT TO authenticated USING (provider_id = auth.uid());

-- 2. Tabela de níveis de qualidade (para registrar o histórico)
CREATE TABLE IF NOT EXISTS public.quality_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  level text NOT NULL CHECK (level IN ('alta', 'media', 'baixa')),
  score integer NOT NULL DEFAULT 0,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id)
);

GRANT SELECT ON public.quality_levels TO anon, authenticated;
GRANT ALL ON public.quality_levels TO service_role;

ALTER TABLE public.quality_levels ENABLE ROW LEVEL SECURITY;

-- Policy: authenticated users can view quality levels
DROP POLICY IF EXISTS "Authenticated can view quality levels" ON public.quality_levels;
CREATE POLICY "Authenticated can view quality levels" ON public.quality_levels
  FOR SELECT TO authenticated USING (true);

-- Policy: providers can view their own quality level
DROP POLICY IF EXISTS "Providers can view own quality level" ON public.quality_levels;
CREATE POLICY "Providers can view own quality level" ON public.quality_levels
  FOR SELECT TO authenticated USING (provider_id = auth.uid());

-- 3. Função para calcular e atualizar o nível de qualidade
CREATE OR REPLACE FUNCTION public.calculate_quality_score(p_provider_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_score integer;
  v_reviews_positive integer;
  v_complaints integer;
BEGIN
  -- Avaliações >= 4 contam +1; reclamações contam -1
  SELECT count(*) INTO v_reviews_positive
  FROM public.reviews
  WHERE provider_id = p_provider_id AND rating >= 4;

  SELECT count(*) INTO v_complaints
  FROM public.complaints
  WHERE provider_id = p_provider_id AND status <> 'resolvida';

  v_score := v_reviews_positive - v_complaints;
  RETURN v_score;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_quality_level()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_score integer;
BEGIN
  v_score := public.calculate_quality_score(NEW.provider_id);

  UPDATE public.quality_levels
  SET level = CASE 
    WHEN v_score > 0 THEN 'alta'
    WHEN v_score < 0 THEN 'baixa'
    ELSE 'media'
  END,
    score = v_score,
    calculated_at = now()
  WHERE provider_id = NEW.provider_id;
  
  IF NOT FOUND THEN
    -- Inserir novo registo se não existir
    INSERT INTO public.quality_levels (provider_id, level, score, calculated_at)
    VALUES (NEW.provider_id, 'media', v_score, now());
  END IF;
  
  RETURN NEW;
END;
$$;

-- 4. Trigger: atualizar nível de qualidade após inserir reclamação
DROP TRIGGER IF EXISTS update_quality_after_complaint ON public.complaints;
CREATE TRIGGER update_quality_after_complaint
  AFTER INSERT ON public.complaints
  FOR EACH ROW EXECUTE FUNCTION public.update_quality_level();

-- 5. Inicializar níveis de qualidade para todos os prestadores existentes
DO $$
DECLARE
  prov record;
BEGIN
  FOR prov IN
    SELECT DISTINCT p.id
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.user_id
    WHERE ur.role = 'provider'
  LOOP
    INSERT INTO public.quality_levels (provider_id, level, score, calculated_at)
    VALUES (prov.id, 'media', 0, now())
    ON CONFLICT (provider_id) DO NOTHING;
  END LOOP;
END $$;
