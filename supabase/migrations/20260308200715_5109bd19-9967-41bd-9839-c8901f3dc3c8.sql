
-- Portfolio images table
CREATE TABLE public.portfolio_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  caption text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.portfolio_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Portfolio images viewable by everyone"
ON public.portfolio_images FOR SELECT
USING (true);

CREATE POLICY "Providers can insert own portfolio images"
ON public.portfolio_images FOR INSERT
WITH CHECK (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = provider_id AND user_id = auth.uid())
);

CREATE POLICY "Providers can delete own portfolio images"
ON public.portfolio_images FOR DELETE
USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = provider_id AND user_id = auth.uid())
);

-- Messages table
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL,
  receiver_id uuid NOT NULL,
  content text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own messages"
ON public.messages FOR SELECT
TO authenticated
USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

CREATE POLICY "Users can send messages"
ON public.messages FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = sender_id);

CREATE POLICY "Users can mark messages as read"
ON public.messages FOR UPDATE
TO authenticated
USING (auth.uid() = receiver_id);

-- Enable realtime for messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;

-- Create storage bucket for portfolio
INSERT INTO storage.buckets (id, name, public) VALUES ('portfolio', 'portfolio', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Anyone can view portfolio images"
ON storage.objects FOR SELECT
USING (bucket_id = 'portfolio');

CREATE POLICY "Authenticated users can upload portfolio images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'portfolio');

CREATE POLICY "Users can delete own portfolio images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'portfolio' AND (storage.foldername(name))[1] = auth.uid()::text);
