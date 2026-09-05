-- Add merchant_code (Orange Money USSD code) to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS merchant_code text;
