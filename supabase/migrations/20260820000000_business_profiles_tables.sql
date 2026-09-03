-- ============================================================
-- Perfis Restaurante/Loja — Parte 1 (estrutura de dados)
-- Versão IDEMPOTENTE — pode correr várias vezes (SQL Editor)
-- NOTA: a função register_as_business está noutro ficheiro porque
-- o novo valor do enum não pode ser usado na mesma transação.
-- ============================================================

-- 1. Novo role 'business' na enumeração app_role
DO $$ BEGIN
  ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'business';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. profiles: tipo de perfil + opções de consumo (restaurante/loja)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS profile_type text NOT NULL DEFAULT 'provider'
    CHECK (profile_type IN ('provider', 'business'));

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS consumption_options text[] NOT NULL DEFAULT '{}'::text[]
    CHECK (consumption_options <@ ARRAY['comer_no_local', 'para_levar', 'entrega']::text[]);

-- 3. Categorias do menu (o dono cria as suas próprias)
CREATE TABLE IF NOT EXISTS public.menu_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, name)
);
ALTER TABLE public.menu_categories ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.menu_categories TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.menu_categories TO authenticated;
GRANT ALL ON public.menu_categories TO service_role;

DROP POLICY IF EXISTS "Menu categories viewable by everyone" ON public.menu_categories;
CREATE POLICY "Menu categories viewable by everyone" ON public.menu_categories
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Menu categories owner manage" ON public.menu_categories;
CREATE POLICY "Menu categories owner manage" ON public.menu_categories
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = menu_categories.business_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = menu_categories.business_id AND p.user_id = auth.uid()));

DROP POLICY IF EXISTS "Menu categories admins manage" ON public.menu_categories;
CREATE POLICY "Menu categories admins manage" ON public.menu_categories
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 4. Itens do menu (pratos/produtos)
CREATE TABLE IF NOT EXISTS public.menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.menu_categories(id) ON DELETE SET NULL,
  name text NOT NULL,
  price numeric(12,2) NOT NULL CHECK (price >= 0),
  photo_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.menu_items TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.menu_items TO authenticated;
GRANT ALL ON public.menu_items TO service_role;

DROP POLICY IF EXISTS "Menu items viewable by everyone" ON public.menu_items;
CREATE POLICY "Menu items viewable by everyone" ON public.menu_items
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Menu items owner manage" ON public.menu_items;
CREATE POLICY "Menu items owner manage" ON public.menu_items
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = menu_items.business_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = menu_items.business_id AND p.user_id = auth.uid()));

DROP POLICY IF EXISTS "Menu items admins manage" ON public.menu_items;
CREATE POLICY "Menu items admins manage" ON public.menu_items
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 5. Realtime (dashboard do admin vê novos menus ao vivo)
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.menu_items; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.menu_categories; EXCEPTION WHEN duplicate_object THEN NULL; END $$;