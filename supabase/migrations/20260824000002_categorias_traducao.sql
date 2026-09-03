-- ============================================================
-- Categorias: traduções EN/FR
-- Admin cria categoria em PT e adiciona traduções EN/FR
-- ============================================================

-- categories (prestadores)
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS name_en text;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS name_fr text;

-- business_categories (lojas)
ALTER TABLE public.business_categories ADD COLUMN IF NOT EXISTS name_en text;
ALTER TABLE public.business_categories ADD COLUMN IF NOT EXISTS name_fr text;

-- Comentários para documentação
COMMENT ON COLUMN public.categories.name IS 'Nome em PT (chave principal, usado em profiles.category)';
COMMENT ON COLUMN public.categories.name_en IS 'Tradução EN';
COMMENT ON COLUMN public.categories.name_fr IS 'Tradução FR';
COMMENT ON COLUMN public.business_categories.name_en IS 'Tradução EN';
COMMENT ON COLUMN public.business_categories.name_fr IS 'Tradução FR';
