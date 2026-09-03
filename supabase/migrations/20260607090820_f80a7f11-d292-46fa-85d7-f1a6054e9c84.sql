-- Add moderation status to reviews
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pendente';

-- Replace public SELECT policy: only approved reviews are publicly visible
DROP POLICY IF EXISTS "Public can view reviews" ON public.reviews;
CREATE POLICY "Public can view approved reviews"
  ON public.reviews FOR SELECT
  TO anon, authenticated
  USING (status = 'aprovado');
