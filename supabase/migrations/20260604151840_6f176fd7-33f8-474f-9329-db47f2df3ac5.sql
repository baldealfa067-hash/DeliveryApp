
ALTER TABLE public.service_requests ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.service_requests ADD COLUMN IF NOT EXISTS requester_name text;
ALTER TABLE public.service_requests ADD COLUMN IF NOT EXISTS requester_phone text;

DROP POLICY IF EXISTS "Clients can create requests" ON public.service_requests;
DROP POLICY IF EXISTS "Clients can delete own requests" ON public.service_requests;
DROP POLICY IF EXISTS "Clients can update own requests" ON public.service_requests;
DROP POLICY IF EXISTS "Anyone can view open requests" ON public.service_requests;

CREATE POLICY "Public can view requests" ON public.service_requests FOR SELECT USING (true);
CREATE POLICY "Public can create requests" ON public.service_requests FOR INSERT WITH CHECK (true);

GRANT SELECT, INSERT ON public.service_requests TO anon;
GRANT SELECT, INSERT ON public.service_requests TO authenticated;
GRANT ALL ON public.service_requests TO service_role;
