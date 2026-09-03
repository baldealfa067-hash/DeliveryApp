-- ============================================================
-- Publicar tabelas do admin no supabase_realtime
-- (dashboard do admin atualiza ao vivo: reviews, perfis, pedidos,
--  qualidade, portfólio, categorias e bairros)
-- Versão IDEMPOTENTE — pode correr várias vezes (SQL Editor)
-- ============================================================

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.reviews; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.service_requests; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.quality_levels; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.portfolio_images; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.categories; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.bairros; EXCEPTION WHEN duplicate_object THEN NULL; END $$;