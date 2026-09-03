-- ============================================================
-- FIX CRÍTICO #9 — Remover anon key hard-coded do Postgres
-- ============================================================
-- Antes: push_notifications.sql:86,120 tinha
--   'Authorization', 'Bearer ' || 'eyJhbGci...'
--   hard-coded dentro de net.http_post. Rotação da anon key quebra
--   push silenciosamente e expõe segredo em dump SQL.
--
-- Depois: usar Supabase Vault (vault.decrypted_secrets) se disponível,
--   senão fallback para app.settings.anon_key via current_setting.
--   Se nenhum estiver configurado, tenta sem Authorization (função push-send
--   aceita chamada via service_role se configurada com verify_jwt=false,
--   caso contrário apenas loga e não quebra a notificação in-app).
--
-- Para ativar Vault em produção:
--   SELECT vault.create_secret('eyJ...anon...', 'supabase_anon_key');
--   -- ou via Dashboard > Vault
--   -- Alternativa sem Vault: ALTER DATABASE postgres SET app.settings.anon_key = 'eyJ...';
--
-- Idempotente.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;

-- Helper para obter a anon key de forma segura
CREATE OR REPLACE FUNCTION public.get_anon_key()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, extensions
AS $$
DECLARE
  v_key text;
BEGIN
  -- 1. Tentar Vault (usar EXECUTE para evitar erro de compilação se schema vault não existir)
  BEGIN
    EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''supabase_anon_key'' LIMIT 1' INTO v_key;
    IF v_key IS NOT NULL AND v_key <> '' THEN
      RETURN v_key;
    END IF;
  EXCEPTION WHEN others THEN
    -- vault não instalado ou sem permissão, ignora
    NULL;
  END;

  -- 2. Tentar current_setting
  BEGIN
    v_key := current_setting('app.settings.anon_key', true);
    IF v_key IS NOT NULL AND v_key <> '' THEN
      RETURN v_key;
    END IF;
  EXCEPTION WHEN others THEN
    NULL;
  END;

  -- 3. Sem chave configurada — retornar vazio (push-send pode estar com verify_jwt=false)
  RETURN '';
END;
$$;

-- Recriar push_after_notification sem hard-code
CREATE OR REPLACE FUNCTION public.push_after_notification()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_key text;
BEGIN
  BEGIN
    v_key := public.get_anon_key();
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
      CASE WHEN v_key <> '' THEN
        jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key)
      ELSE
        jsonb_build_object('Content-Type','application/json')
      END,
      5000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'push_after_notification falhou: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- Recriar push_nearby_novidade sem hard-code
CREATE OR REPLACE FUNCTION public.push_nearby_novidade()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_key text;
BEGIN
  IF NEW.category IS NULL OR NEW.category = '' OR NEW.location IS NULL OR NEW.location = '' THEN
    RETURN NEW;
  END IF;
  BEGIN
    v_key := public.get_anon_key();
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
      CASE WHEN v_key <> '' THEN
        jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key)
      ELSE
        jsonb_build_object('Content-Type','application/json')
      END,
      5000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'push_nearby_novidade falhou: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- Recriar triggers (idempotente)
DROP TRIGGER IF EXISTS on_notification_created_push ON public.notifications;
CREATE TRIGGER on_notification_created_push
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.push_after_notification();

DROP TRIGGER IF EXISTS on_profiles_insert_novidade ON public.profiles;
CREATE TRIGGER on_profiles_insert_novidade
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.push_nearby_novidade();

-- Revogar acesso indevido
REVOKE ALL ON FUNCTION public.get_anon_key() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_anon_key() TO service_role;
