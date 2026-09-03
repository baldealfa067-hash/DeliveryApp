-- Allow anonymous senders in messages table
-- sender_id can now be null for anonymous users (client-side generated UUID)

-- Make sender_id nullable (was NOT NULL)
ALTER TABLE public.messages ALTER COLUMN sender_id DROP NOT NULL;

-- Drop the old INSERT policy that required auth.uid() = sender_id
DROP POLICY IF EXISTS "Users can send messages" ON public.messages;

-- New INSERT policy: allow authenticated users OR anonymous (sender_id is null or different)
CREATE POLICY "Anyone can send messages"
ON public.messages FOR INSERT
TO public
WITH CHECK (
  auth.uid() = sender_id
  OR sender_id IS NULL
  OR auth.uid() IS NULL
);

-- Update SELECT policy to also allow viewing anonymous messages
DROP POLICY IF EXISTS "Users can view own messages" ON public.messages;

CREATE POLICY "Users can view own messages"
ON public.messages FOR SELECT
TO public
USING (
  auth.uid() = sender_id
  OR auth.uid() = receiver_id
  OR sender_id IS NULL
);

-- Update UPDATE policy (mark as read) — receiver can always mark
DROP POLICY IF EXISTS "Users can mark messages as read" ON public.messages;

CREATE POLICY "Users can mark messages as read"
ON public.messages FOR UPDATE
TO public
USING (auth.uid() = receiver_id)
WITH CHECK (auth.uid() = receiver_id);
