-- Add message_type and image_url to messages table
-- (migration 20260829010000 was never applied to remote)
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS message_type text DEFAULT 'text' NOT NULL;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS image_url text;
