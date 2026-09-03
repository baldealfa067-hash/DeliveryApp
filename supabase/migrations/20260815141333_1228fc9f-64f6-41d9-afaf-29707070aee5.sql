ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS services text[] NOT NULL DEFAULT '{}'::text[];
CREATE INDEX IF NOT EXISTS profiles_services_idx ON public.profiles USING GIN (services);