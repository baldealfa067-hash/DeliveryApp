-- Push notifications: subscrições web-push + ligação dos eventos ao envio.

-- 1. Tabela de subscrições push (uma linha por dispositivo)
CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  keys jsonb NOT NULL DEFAULT '{}'::jsonb,
  push_enabled boolean NOT NULL DEFAULT true,
  novidades boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_push_subscriptions_user ON public.push_subscriptions(user_id);
CREATE INDEX idx_push_subscriptions_novidades ON public.push_subscriptions(novidades) WHERE novidades = true;

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Cada utilizador gere as suas subscrições (ler/apagar)
CREATE POLICY "Users read own push subscriptions" ON public.push_subscriptions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own push subscriptions" ON public.push_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own push subscriptions" ON public.push_subscriptions
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own push subscriptions" ON public.push_subscriptions
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;

-- 2. RPC: guarda/atualiza a subscrição do dispositivo atual (SECURITY DEFINER
-- para conseguir reaproveitar o mesmo endpoint quando a conta muda no aparelho).
CREATE OR REPLACE FUNCTION public.upsert_push_subscription(
  p_endpoint text,
  p_keys jsonb,
  p_push_enabled boolean DEFAULT true,
  p_novidades boolean DEFAULT false
) RETURNS public.push_subscriptions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row public.push_subscriptions;
BEGIN
  INSERT INTO public.push_subscriptions (user_id, endpoint, keys, push_enabled, novidades)
  VALUES (auth.uid(), p_endpoint, p_keys, p_push_enabled, p_novidades)
  ON CONFLICT (endpoint) DO UPDATE
    SET user_id = auth.uid(),
        keys = EXCLUDED.keys,
        push_enabled = EXCLUDED.push_enabled,
        novidades = EXCLUDED.novidades,
        updated_at = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- 3. Trigger: sempre que uma notificação in-app é criada, pede o envio push.
CREATE OR REPLACE FUNCTION public.push_after_notification()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM net.http_post(
    'https://pfvuqehchkamhgjlugqn.supabase.co/functions/v1/push-send',
    jsonb_build_object(
      'kind', 'notification',
      'user_id', NEW.user_id::text,
      'type', NEW.type,
      'title', NEW.title,
      'body', NEW.body,
      'link', COALESCE(NEW.link, '/'),
      'request_id', NEW.request_id::text
    ),
    '{}'::jsonb,
    jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmdnVxZWhjaGthbWhnamx1Z3FuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4OTM2MjgsImV4cCI6MjEwMjQ2OTYyOH0.cGAHjlkhF89jpMBEiX9YujcUqYYBYXeQncn0oFLw5fs'
    ),
    5000
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_notification_created_push
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.push_after_notification();

-- 4. Trigger: novo prestador/restaurante com bairro definido -> "novidades
-- perto de mim" (push-only; só chega a quem ativou a opção nas definições).
CREATE OR REPLACE FUNCTION public.push_nearby_novidade()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.category IS NULL OR NEW.category = '' OR NEW.location IS NULL OR NEW.location = '' THEN
    RETURN NEW;
  END IF;
  PERFORM net.http_post(
    'https://pfvuqehchkamhgjlugqn.supabase.co/functions/v1/push-send',
    jsonb_build_object(
      'kind', 'novidades',
      'location', NEW.location,
      'name', NEW.name,
      'category', NEW.category,
      'profile_type', NEW.profile_type,
      'author_user_id', COALESCE(NEW.user_id::text, '')
    ),
    '{}'::jsonb,
    jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmdnVxZWhjaGthbWhnamx1Z3FuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4OTM2MjgsImV4cCI6MjEwMjQ2OTYyOH0.cGAHjlkhF89jpMBEiX9YujcUqYYBYXeQncn0oFLw5fs'
    ),
    5000
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_profiles_insert_novidade
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.push_nearby_novidade();