DROP POLICY IF EXISTS "Users can read own roles" ON public.user_roles;
CREATE POLICY "Users can read own roles" ON public.user_roles
FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;
CREATE POLICY "Admins manage roles" ON public.user_roles
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins manage profiles" ON public.profiles;
CREATE POLICY "Admins manage profiles" ON public.profiles
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Providers update own profile" ON public.profiles;
CREATE POLICY "Providers update own profile" ON public.profiles
FOR UPDATE TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Providers insert own profile" ON public.profiles;
CREATE POLICY "Providers insert own profile" ON public.profiles
FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins manage portfolio" ON public.portfolio_images;
CREATE POLICY "Admins manage portfolio" ON public.portfolio_images
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Providers manage own portfolio" ON public.portfolio_images;
CREATE POLICY "Providers manage own portfolio" ON public.portfolio_images
FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = portfolio_images.provider_id AND p.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = portfolio_images.provider_id AND p.user_id = auth.uid()));

DROP POLICY IF EXISTS "Admins manage service_requests" ON public.service_requests;
CREATE POLICY "Admins manage service_requests" ON public.service_requests
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins manage reviews" ON public.reviews;
CREATE POLICY "Admins manage reviews" ON public.reviews
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));