-- Add image_url to messages
ALTER TABLE public.messages ADD COLUMN image_url text;

-- Create blocked_users table
CREATE TABLE public.blocked_users (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  blocker_id uuid NOT NULL,
  blocked_id uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(blocker_id, blocked_id)
);

ALTER TABLE public.blocked_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can block others"
ON public.blocked_users FOR INSERT
TO public
WITH CHECK (auth.uid() = blocker_id);

CREATE POLICY "Users can unblock others"
ON public.blocked_users FOR DELETE
TO public
USING (auth.uid() = blocker_id);

CREATE POLICY "Users can see their blocks"
ON public.blocked_users FOR SELECT
TO public
USING (auth.uid() = blocker_id OR auth.uid() = blocked_id);

-- Create user_reports table
CREATE TABLE public.user_reports (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  reporter_id uuid NOT NULL,
  reported_id uuid NOT NULL,
  reason text NOT NULL,
  description text,
  status text DEFAULT 'pendente' NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can report others"
ON public.user_reports FOR INSERT
TO public
WITH CHECK (auth.uid() = reporter_id);

CREATE POLICY "Users can see own reports"
ON public.user_reports FOR SELECT
TO public
USING (auth.uid() = reporter_id);

-- Add message_type for distinguishing text vs image
ALTER TABLE public.messages ADD COLUMN message_type text DEFAULT 'text' NOT NULL;
