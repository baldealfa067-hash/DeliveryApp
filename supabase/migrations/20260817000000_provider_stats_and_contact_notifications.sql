-- ============================================================
-- Estatísticas de prestador + notificações de contacto
-- Versão IDEMPOTENTE — pode correr várias vezes (SQL Editor)
-- ============================================================

-- 1. Tabela de estatísticas por prestador
CREATE TABLE IF NOT EXISTS public.provider_stats (
  provider_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  profile_views bigint NOT NULL DEFAULT 0,
  whatsapp_clicks bigint NOT NULL DEFAULT 0,
  call_clicks bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.provider_stats TO anon, authenticated;
GRANT ALL ON public.provider_stats TO service_role;

ALTER TABLE public.provider_stats ENABLE ROW LEVEL SECURITY;

-- Qualquer autenticado pode LER estatísticas (prestador vê as suas, admin vê todas)
DROP POLICY IF EXISTS "Authenticated can view provider stats" ON public.provider_stats;
CREATE POLICY "Authenticated can view provider stats" ON public.provider_stats
  FOR SELECT TO authenticated USING (true);

-- (Escritas só via funções SECURITY DEFINER abaixo, não via RLS direto)

-- 2. RPC: registar uma vista de perfil + notificar o prestador
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

  -- Notifica o prestador (exceto se for ele próprio a ver)
  SELECT user_id INTO provider_user FROM public.profiles WHERE id = p_provider_id;
  IF provider_user IS NOT NULL AND provider_user IS DISTINCT FROM auth.uid() THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (provider_user, 'vista', 'Nova vista do perfil',
            'Alguém visitou o seu perfil agora.',
            '/perfil');
  END IF;
END;
$$;

-- 3. RPC: registar contacto (whatsapp/call) + notificar o prestador
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

  -- Incrementa o contador correspondente
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

  -- Notifica o prestador (exceto se for ele próprio a contactar)
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

-- 4. Trigger: notificar prestador quando alguém comenta/avalia o perfil
CREATE OR REPLACE FUNCTION public.notify_provider_on_review()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  provider_user uuid;
BEGIN
  SELECT user_id INTO provider_user FROM public.profiles WHERE id = NEW.provider_id;
  IF provider_user IS NOT NULL AND provider_user IS DISTINCT FROM COALESCE(NEW.user_id, provider_user) THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (provider_user, 'comentario', 'Novo comentário no perfil',
            'Alguém comentou e avaliou o teu perfil.',
            '/prestador/' || NEW.provider_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_review_created ON public.reviews;
CREATE TRIGGER on_review_created
  AFTER INSERT ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.notify_provider_on_review();