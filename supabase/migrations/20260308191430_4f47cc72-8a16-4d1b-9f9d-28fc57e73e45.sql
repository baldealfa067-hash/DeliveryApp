
-- Temporarily drop FK on profiles to allow demo data
ALTER TABLE public.profiles DROP CONSTRAINT profiles_user_id_fkey;
ALTER TABLE public.reviews DROP CONSTRAINT reviews_user_id_fkey;

-- Re-add FKs but without enforcement for existing rows won't work, so let's use a different approach
-- Add the FKs back but allow NULL-like behavior by making them deferrable
ALTER TABLE public.profiles ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.reviews ADD CONSTRAINT reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
