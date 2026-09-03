CREATE TABLE public.bairros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.bairros TO anon, authenticated;
GRANT ALL ON public.bairros TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.bairros TO authenticated;
ALTER TABLE public.bairros ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Bairros visíveis a todos" ON public.bairros FOR SELECT USING (true);
CREATE POLICY "Apenas admin cria bairros" ON public.bairros FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Apenas admin atualiza bairros" ON public.bairros FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Apenas admin elimina bairros" ON public.bairros FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.bairros (name)
SELECT * FROM (VALUES
  ('Antula'),
  ('Bairro Militar'),
  ('Bandim'),
  ('Belém'),
  ('Centro / Praça'),
  ('Chapa de Bissau'),
  ('Cuntum'),
  ('Cupelum'),
  ('Mindará'),
  ('Pluba'),
  ('Santa Luzia')
) AS v(name)
ON CONFLICT (name) DO NOTHING;
