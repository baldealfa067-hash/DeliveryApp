
ALTER TABLE public.reviews ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS reviewer_name text;

DROP POLICY IF EXISTS "Users can create reviews" ON public.reviews;
DROP POLICY IF EXISTS "Users can delete own reviews" ON public.reviews;
DROP POLICY IF EXISTS "Users can update own reviews" ON public.reviews;
DROP POLICY IF EXISTS "Reviews are viewable by everyone" ON public.reviews;

CREATE POLICY "Public can view reviews" ON public.reviews FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public can create reviews" ON public.reviews FOR INSERT TO anon, authenticated WITH CHECK (true);

GRANT SELECT, INSERT ON public.reviews TO anon;
GRANT SELECT, INSERT ON public.reviews TO authenticated;
GRANT ALL ON public.reviews TO service_role;
