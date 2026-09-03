-- ============================================================
-- FIX CRÍTICO #7 — XSS + validação DB em profundidade
-- ============================================================
-- Antes: RLS validava só service_requests; reviews/complaints/profiles
-- aceitavam strings gigantes sem limite e sem sanitização DB.
-- Depois: CHECKs de tamanho + sem tags <> em colunas de texto livre.
-- O frontend já faz sanitize.ts (strip <...>), mas DB garante defesa
-- mesmo se bypassar a API.
--
-- Também adiciona CHECK para profiles.description/name que eram TEXT livre.
-- Idempotente.
-- ============================================================

-- PROFILES
DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 80);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_phone_len CHECK (phone IS NULL OR char_length(phone) <= 25);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_description_len CHECK (description IS NULL OR char_length(description) <= 2000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_no_html CHECK (description IS NULL OR description NOT LIKE '%<%' AND description NOT LIKE '%>%');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- REVIEWS (comentários já limitados em migration anterior, reforçar)
DO $$ BEGIN
  ALTER TABLE public.reviews ADD CONSTRAINT reviews_no_html CHECK (comment IS NULL OR (comment NOT LIKE '%<%' AND comment NOT LIKE '%>%'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- COMPLAINTS
DO $$ BEGIN
  ALTER TABLE public.complaints ADD CONSTRAINT complaints_no_html CHECK (description IS NULL OR (description NOT LIKE '%<%' AND description NOT LIKE '%>%'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- SERVICE_REQUESTS já tem char_length checks na policy, mas adicionar CHECKs também
DO $$ BEGIN
  ALTER TABLE public.service_requests ADD CONSTRAINT sr_description_len CHECK (char_length(description) <= 2000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.service_requests ADD CONSTRAINT sr_category_len CHECK (char_length(category) <= 80);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.service_requests ADD CONSTRAINT sr_no_html CHECK (description NOT LIKE '%<%' AND description NOT LIKE '%>%');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- PORTFOLIO / MENU
DO $$ BEGIN
  ALTER TABLE public.portfolio_images ADD CONSTRAINT portfolio_no_html CHECK (image_url NOT LIKE '%<%');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
