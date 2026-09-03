
-- Re-add foreign keys with NOT VALID so existing demo data isn't checked
ALTER TABLE public.profiles ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.reviews ADD CONSTRAINT reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.reviews ADD CONSTRAINT reviews_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.profiles(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.service_requests ADD CONSTRAINT service_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
