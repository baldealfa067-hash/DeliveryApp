CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.categories TO anon, authenticated;
GRANT ALL ON public.categories TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.categories TO authenticated;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Categorias visíveis a todos" ON public.categories FOR SELECT USING (true);
CREATE POLICY "Apenas admin cria categorias" ON public.categories FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Apenas admin atualiza categorias" ON public.categories FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Apenas admin elimina categorias" ON public.categories FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.categories (name)
SELECT DISTINCT category FROM public.profiles WHERE category IS NOT NULL
ON CONFLICT (name) DO NOTHING;