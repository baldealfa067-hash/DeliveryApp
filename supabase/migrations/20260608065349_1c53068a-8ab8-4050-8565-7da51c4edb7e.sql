
-- 1. Privilege escalation: replace insecure user_roles INSERT with a SECURITY DEFINER function
DROP POLICY IF EXISTS "Users can insert own role" ON public.user_roles;

CREATE OR REPLACE FUNCTION public.register_as_provider()
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
  VALUES (auth.uid(), 'provider')
  ON CONFLICT (user_id, role) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.register_as_provider() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_as_provider() TO authenticated;

-- 2. Hide requester phone/name from public visitors on service_requests
DROP POLICY IF EXISTS "Public can view requests" ON public.service_requests;
CREATE POLICY "Authenticated users can view requests"
  ON public.service_requests
  FOR SELECT
  TO authenticated
  USING (true);

-- 3. Storage: scope portfolio INSERT to the user's own folder
DROP POLICY IF EXISTS "Authenticated users can upload portfolio images" ON storage.objects;
CREATE POLICY "Authenticated users can upload to own portfolio folder"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'portfolio'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
