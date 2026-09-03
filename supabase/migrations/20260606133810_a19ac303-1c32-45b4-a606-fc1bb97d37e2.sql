
-- Verified badge on profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_verified boolean NOT NULL DEFAULT false;

-- Proposals table
CREATE TABLE public.proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  category text NOT NULL,
  description text NOT NULL,
  price integer NOT NULL CHECK (price >= 0),
  price_type text NOT NULL DEFAULT 'desde' CHECK (price_type IN ('fixo','desde')),
  location text NOT NULL,
  status text NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa','pausada')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.proposals TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.proposals TO authenticated;
GRANT ALL ON public.proposals TO service_role;

ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;

-- Anyone can read active proposals; owners/admins can read all
CREATE POLICY "Public can view active proposals"
ON public.proposals FOR SELECT
USING (
  status = 'ativa'
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = proposals.provider_id AND p.user_id = auth.uid())
  OR public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "Providers can insert own proposals"
ON public.proposals FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = proposals.provider_id AND p.user_id = auth.uid()));

CREATE POLICY "Providers can update own proposals"
ON public.proposals FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = proposals.provider_id AND p.user_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = proposals.provider_id AND p.user_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Providers can delete own proposals"
ON public.proposals FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = proposals.provider_id AND p.user_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_proposals_updated_at
BEFORE UPDATE ON public.proposals
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_proposals_status_category ON public.proposals(status, category);
CREATE INDEX idx_proposals_provider ON public.proposals(provider_id);
