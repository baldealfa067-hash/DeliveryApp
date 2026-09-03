-- ============================================================
-- Categoria "Beleza & Estética" — estrutura própria, separada de
-- Serviços (providers) e Restaurantes/Lojas (business).
-- - Novo role 'beleza' + profile_type 'beleza'
-- - beauty_categories: subcategorias do setor (seed incluída)
-- - beauty_items: catálogo simples com TIPO DE PREÇO por item
--   ('fixo' com valor | 'negociavel' sem valor -> "A combinar")
-- Versão IDEMPOTENTE — pode correr várias vezes (SQL Editor)
-- ============================================================

-- 1. Novo role 'beleza' na enumeração app_role
DO $$ BEGIN
  ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'beleza';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. profiles.profile_type passa a aceitar 'beleza'
DO $$
DECLARE c text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND contype = 'c'
      AND conname = 'profiles_profile_type_check'
      AND pg_get_constraintdef(oid) LIKE '%beleza%'
  ) THEN
    SELECT conname INTO c FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND contype = 'c'
      AND conname = 'profiles_profile_type_check';
    IF c IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', c);
    END IF;
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_profile_type_check
      CHECK (profile_type IN ('provider', 'business', 'beleza'));
  END IF;
END $$;

-- 3. Subcategorias do setor Beleza & Estética
CREATE TABLE IF NOT EXISTS public.beauty_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  name_en text,
  name_fr text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.beauty_categories ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.beauty_categories TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.beauty_categories TO authenticated;
GRANT ALL ON public.beauty_categories TO service_role;
COMMENT ON COLUMN public.beauty_categories.name IS 'Nome em PT (chave principal, usado em profiles.category)';
COMMENT ON COLUMN public.beauty_categories.name_en IS 'Tradução EN';
COMMENT ON COLUMN public.beauty_categories.name_fr IS 'Tradução FR';

DROP POLICY IF EXISTS "beauty_categories public read" ON public.beauty_categories;
CREATE POLICY "beauty_categories public read" ON public.beauty_categories
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "beauty_categories admin insert" ON public.beauty_categories;
CREATE POLICY "beauty_categories admin insert" ON public.beauty_categories
  FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "beauty_categories admin update" ON public.beauty_categories;
CREATE POLICY "beauty_categories admin update" ON public.beauty_categories
  FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "beauty_categories admin delete" ON public.beauty_categories;
CREATE POLICY "beauty_categories admin delete" ON public.beauty_categories
  FOR DELETE USING (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.beauty_categories (name, name_en, name_fr) VALUES
  ('Salão de Beleza', 'Beauty Salon', 'Salon de beauté'),
  ('Barbearia', 'Barbershop', 'Barbier'),
  ('Salão de Unhas', 'Nail Salon', 'Salon de manucure'),
  ('Cabeleireiro', 'Hairdresser', 'Coiffeur'),
  ('Spa', 'Spa', 'Spa'),
  ('Estética e Skincare', 'Aesthetics & Skincare', 'Esthétique et soins de la peau'),
  ('Sobrancelhas e Cílios', 'Brows & Lashes', 'Sourcils et cils'),
  ('Maquilhagem', 'Makeup', 'Maquillage'),
  ('Depilação', 'Waxing & Hair Removal', 'Épilation'),
  ('Massagem e Bem-estar', 'Massage & Wellness', 'Massage et bien-être')
ON CONFLICT (name) DO NOTHING;

-- 4. Catálogo: itens/serviços simples (sem categorias obrigatórias)
--    Cada item tem TIPO DE PREÇO escolhido por quem publica:
--    - 'fixo': exige price >= 0
--    - 'negociavel': sem valor fixo (price NULL) -> exibe "A combinar"
CREATE TABLE IF NOT EXISTS public.beauty_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  price_type text NOT NULL DEFAULT 'fixo' CHECK (price_type IN ('fixo', 'negociavel')),
  price numeric(12,2),
  photo_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT beauty_items_price_check CHECK (
    (price_type = 'fixo' AND price IS NOT NULL AND price >= 0)
    OR (price_type = 'negociavel' AND price IS NULL)
  )
);
ALTER TABLE public.beauty_items ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.beauty_items TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.beauty_items TO authenticated;
GRANT ALL ON public.beauty_items TO service_role;

-- Endurece o CHECK (negociavel => price IS NULL) se a versão antiga existir
DO $$
DECLARE c text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.beauty_items'::regclass
      AND contype = 'c'
      AND conname = 'beauty_items_price_check'
      AND pg_get_constraintdef(oid) LIKE '%OR (price_type = ''negociavel''::text)%'
      AND pg_get_constraintdef(oid) NOT LIKE '%AND (price IS NULL)%'
  ) THEN
    ALTER TABLE public.beauty_items DROP CONSTRAINT beauty_items_price_check;
    ALTER TABLE public.beauty_items ADD CONSTRAINT beauty_items_price_check CHECK (
      (price_type = 'fixo' AND price IS NOT NULL AND price >= 0)
      OR (price_type = 'negociavel' AND price IS NULL)
    );
  END IF;
END $$;

DROP POLICY IF EXISTS "Beauty items viewable by everyone" ON public.beauty_items;
CREATE POLICY "Beauty items viewable by everyone" ON public.beauty_items
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Beauty items owner manage" ON public.beauty_items;
CREATE POLICY "Beauty items owner manage" ON public.beauty_items
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = beauty_items.business_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = beauty_items.business_id AND p.user_id = auth.uid()));

DROP POLICY IF EXISTS "Beauty items admins manage" ON public.beauty_items;
CREATE POLICY "Beauty items admins manage" ON public.beauty_items
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 5. RPC: atribui o role 'beleza' ao utilizador autenticado
CREATE OR REPLACE FUNCTION public.register_as_beleza()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (auth.uid(), 'beleza')
  ON CONFLICT (user_id, role) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.register_as_beleza() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_as_beleza() TO authenticated;

-- 6. Realtime (dashboard do admin vê novos catálogos/categorias ao vivo)
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.beauty_items; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.beauty_categories; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
