-- ============================================================
-- Histórico de atividade do prestador (vistas/WhatsApp/ligações)
-- Versão IDEMPOTENTE — pode correr várias vezes (SQL Editor)
-- ============================================================

-- 1. Tabela de histórico de eventos por prestador
CREATE TABLE IF NOT EXISTS public.provider_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  activity_type text NOT NULL CHECK (activity_type IN ('vista', 'whatsapp', 'call')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_activity_provider_id_idx
  ON public.provider_activity (provider_id, created_at DESC);

GRANT SELECT ON public.provider_activity TO anon, authenticated;
GRANT ALL ON public.provider_activity TO service_role;

ALTER TABLE public.provider_activity ENABLE ROW LEVEL SECURITY;

-- Qualquer autenticado pode LER o histórico (prestador vê o seu, admin vê tudo)
DROP POLICY IF EXISTS "Authenticated can view provider activity" ON public.provider_activity;
CREATE POLICY "Authenticated can view provider activity" ON public.provider_activity
  FOR SELECT TO authenticated USING (true);

-- 2. RPC de vista passa a registar também no histórico
CREATE OR REPLACE FUNCTION public.increment_provider_view(p_provider_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  provider_user uuid;
BEGIN
  INSERT INTO public.provider_stats (provider_id, profile_views)
  VALUES (p_provider_id, 1)
  ON CONFLICT (provider_id)
  DO UPDATE SET profile_views = public.provider_stats.profile_views + 1,
                updated_at = now();

  INSERT INTO public.provider_activity (provider_id, activity_type)
  VALUES (p_provider_id, 'vista');

  SELECT user_id INTO provider_user FROM public.profiles WHERE id = p_provider_id;
  IF provider_user IS NOT NULL AND provider_user IS DISTINCT FROM auth.uid() THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (provider_user, 'vista', 'Nova vista do perfil',
            'Alguém visitou o seu perfil agora.',
            '/perfil');
  END IF;
END;
$$;

-- 3. RPC de contacto passa a registar também no histórico
CREATE OR REPLACE FUNCTION public.record_provider_contact(p_provider_id uuid, contact_type text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  provider_user uuid;
BEGIN
  IF contact_type NOT IN ('whatsapp', 'call') THEN
    RAISE EXCEPTION 'contact_type inválido';
  END IF;

  IF contact_type = 'whatsapp' THEN
    INSERT INTO public.provider_stats (provider_id, whatsapp_clicks)
    VALUES (p_provider_id, 1)
    ON CONFLICT (provider_id)
    DO UPDATE SET whatsapp_clicks = public.provider_stats.whatsapp_clicks + 1,
                  updated_at = now();
  ELSE
    INSERT INTO public.provider_stats (provider_id, call_clicks)
    VALUES (p_provider_id, 1)
    ON CONFLICT (provider_id)
    DO UPDATE SET call_clicks = public.provider_stats.call_clicks + 1,
                  updated_at = now();
  END IF;

  INSERT INTO public.provider_activity (provider_id, activity_type)
  VALUES (p_provider_id, contact_type);

  SELECT user_id INTO provider_user FROM public.profiles WHERE id = p_provider_id;
  IF provider_user IS NOT NULL AND provider_user IS DISTINCT FROM auth.uid() THEN
    IF contact_type = 'whatsapp' THEN
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (provider_user, 'contacto', 'Contacto via WhatsApp',
              'Alguém abriu o teu WhatsApp para falar contigo.',
              '/prestador/' || p_provider_id);
    ELSE
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (provider_user, 'contacto', 'Contacto telefónico',
              'Alguém usou o botão Ligar do teu perfil.',
              '/prestador/' || p_provider_id);
    END IF;
  END IF;
END;
$$;

-- 4. Publicação realtime (vistas/contactos atualizam ao vivo)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.provider_activity;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.provider_stats;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;