-- ============================================================
-- FIX CRÍTICO #3 — Anti-spam avaliações diretas + denúncias anon
-- ============================================================
-- 1. Reviews diretas (request_id IS NULL): impedir spam infinito
--    Antes: UNIQUE (request_id,provider_id) WHERE NOT NULL não cobria NULL,
--    mesmo user podia inserir infinitas 5* diretas.
--    Depois: UNIQUE parcial por (provider_id, user_id) quando request_id NULL
--    + trigger rate-limit: máx 1 avaliação direta por provider a cada 24h
--    + trigger rate-limit anon por IP não possível, mas por reviewer_name+provider
--
-- 2. Complaints anon: flood ilimitado via POST /rest/v1/complaints
--    Depois: trigger que limita 3 denúncias por provider a cada 24h
--    para o mesmo client_id (ou anon) e CHECKs de tamanho.
--
-- Idempotente — pode correr várias vezes
-- ============================================================

-- 1. REVIEWS — índice único para diretas (evita spam mesmo user)
-- Deduplicar antes: há spam real já em prod que impede criar o índice (ex: 24f51443/7be341e2)
DELETE FROM public.reviews a
USING public.reviews b
WHERE a.request_id IS NULL AND b.request_id IS NULL
  AND a.user_id IS NOT NULL AND b.user_id IS NOT NULL
  AND a.provider_id = b.provider_id
  AND a.user_id = b.user_id
  AND a.id > b.id;

DROP INDEX IF EXISTS reviews_direct_once_per_user;
CREATE UNIQUE INDEX reviews_direct_once_per_user
  ON public.reviews (provider_id, user_id)
  WHERE request_id IS NULL AND user_id IS NOT NULL;

-- Reviews anon diretas: limitar por reviewer_name + provider (evita bot com nomes diferentes)
-- Não criamos UNIQUE para anon (user_id NULL) porque NULL != NULL no índice,
-- mas o trigger abaixo bloqueia flood anon também.

-- Trigger rate-limit: máx 1 avaliação direta por provider/24h por user
CREATE OR REPLACE FUNCTION public.check_review_spam()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  cnt int;
BEGIN
  -- Só aplica a avaliações diretas (request_id NULL)
  IF NEW.request_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Se tem user_id, verifica quantas diretas fez nas últimas 24h para este provider
  IF NEW.user_id IS NOT NULL THEN
    SELECT count(*) INTO cnt
    FROM public.reviews
    WHERE provider_id = NEW.provider_id
      AND user_id = NEW.user_id
      AND request_id IS NULL
      AND created_at > now() - interval '24 hours';
    IF cnt >= 1 THEN
      RAISE EXCEPTION 'Já avaliou este prestador nas últimas 24 horas. Tente novamente mais tarde.';
    END IF;
  ELSE
    -- Anon (user_id NULL): limitar por reviewer_name + provider
    IF NEW.reviewer_name IS NOT NULL AND btrim(NEW.reviewer_name) <> '' THEN
      SELECT count(*) INTO cnt
      FROM public.reviews
      WHERE provider_id = NEW.provider_id
        AND reviewer_name = NEW.reviewer_name
        AND user_id IS NULL
        AND request_id IS NULL
        AND created_at > now() - interval '24 hours';
      IF cnt >= 1 THEN
        RAISE EXCEPTION 'Já avaliou este prestador nas últimas 24 horas.';
      END IF;
    END IF;
  END IF;

  -- Limite global anon por provider: máx 5 diretas anon por hora (anti-bot rede)
  SELECT count(*) INTO cnt
  FROM public.reviews
  WHERE provider_id = NEW.provider_id
    AND user_id IS NULL
    AND request_id IS NULL
    AND created_at > now() - interval '1 hour';
  IF cnt >= 5 THEN
    RAISE EXCEPTION 'Muitas avaliações recentes para este prestador. Tente mais tarde.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_review_spam_trigger ON public.reviews;
CREATE TRIGGER check_review_spam_trigger
  BEFORE INSERT ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.check_review_spam();

-- 2. COMPLAINTS — rate-limit 3 denúncias por provider/24h por client_id (ou anon)
CREATE OR REPLACE FUNCTION public.check_complaint_spam()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  cnt int;
BEGIN
  IF NEW.client_id IS NOT NULL THEN
    SELECT count(*) INTO cnt
    FROM public.complaints
    WHERE provider_id = NEW.provider_id
      AND client_id = NEW.client_id
      AND created_at > now() - interval '24 hours';
    IF cnt >= 3 THEN
      RAISE EXCEPTION 'Limite de 3 denúncias por dia atingido para este prestador.';
    END IF;
  ELSE
    -- Anon: limitar por provider — máx 5 denúncias anon por hora por provider
    SELECT count(*) INTO cnt
    FROM public.complaints
    WHERE provider_id = NEW.provider_id
      AND client_id IS NULL
      AND created_at > now() - interval '1 hour';
    IF cnt >= 5 THEN
      RAISE EXCEPTION 'Muitas denúncias anónimas recentes para este prestador. Tente mais tarde.';
    END IF;
    -- Também limitar global anon: máx 10 por dia (qualquer provider) — evita flood rede
    SELECT count(*) INTO cnt
    FROM public.complaints
    WHERE client_id IS NULL
      AND created_at > now() - interval '24 hours';
    IF cnt >= 10 THEN
      RAISE EXCEPTION 'Limite global de denúncias anónimas atingido. Crie uma conta.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_complaint_spam_trigger ON public.complaints;
CREATE TRIGGER check_complaint_spam_trigger
  BEFORE INSERT ON public.complaints
  FOR EACH ROW EXECUTE FUNCTION public.check_complaint_spam();

-- 3. CHECKs de tamanho já cobertos por RLS mas adicionar constraints DB para defesa em profundidade
-- Reviews
DO $$ BEGIN
  ALTER TABLE public.reviews ADD CONSTRAINT reviews_comment_len CHECK (comment IS NULL OR char_length(comment) <= 500);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.reviews ADD CONSTRAINT reviews_reviewer_name_len CHECK (reviewer_name IS NULL OR char_length(reviewer_name) <= 50);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- Complaints
DO $$ BEGIN
  ALTER TABLE public.complaints ADD CONSTRAINT complaints_reason_len CHECK (char_length(reason) <= 100);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.complaints ADD CONSTRAINT complaints_description_len CHECK (description IS NULL OR char_length(description) <= 500);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.complaints ADD CONSTRAINT complaints_contact_len CHECK (contact IS NULL OR char_length(contact) <= 30);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
