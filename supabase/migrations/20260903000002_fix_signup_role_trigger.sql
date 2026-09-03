-- ============================================================
-- FIX CRÍTICO #4 — Cadastro sem role se Confirm Email = ON
-- ============================================================
-- Antes: Login.tsx:133 só fazia rpc(register_as_*) se data.session existir.
-- Se Supabase tem Confirm email ON, session=null e role nunca é criada.
--
-- Depois: trigger AFTER INSERT em auth.users lê raw_user_meta_data e cria
-- a role automaticamente, independente de session. O frontend também passa
-- profile_type no metadata e mostra mensagem adequada quando precisa confirmar.
--
-- Mantém compatibilidade com fluxo existente (session != null) — o RPC
-- faz ON CONFLICT DO NOTHING, então duplo insert é inofensivo.
-- ============================================================

-- Atualizar handle_new_user para também criar user_roles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_profile_type text;
  v_role app_role;
BEGIN
  -- 1. Criar perfil (como antes)
  INSERT INTO public.profiles (user_id, name, category, phone, location)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1), ''),
    '',
    '',
    ''
  )
  ON CONFLICT (user_id) DO NOTHING;

  -- 2. Criar role baseado no metadata passado no signUp
  -- O frontend agora envia { name, profile_type: 'provider|business|beleza|client' }
  v_profile_type := COALESCE(NEW.raw_user_meta_data->>'profile_type', 'provider');

  -- Mapear profile_type para app_role
  -- provider -> provider, business -> business, beleza -> beleza, client -> client
  BEGIN
    v_role := v_profile_type::app_role;
  EXCEPTION WHEN others THEN
    -- Se o valor não for um app_role válido, usa provider como fallback
    v_role := 'provider';
  END;

  -- Tentar inserir a role; se já existe (ex: RPC do frontend), ignora
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, v_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Garantir que a extensão app_role aceita os valores necessários
-- (provider, business, beleza, client, admin já devem existir)
DO $$
BEGIN
  -- Tentar adicionar valores ao enum se não existirem (idempotente)
  BEGIN
    ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'business';
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'beleza';
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'client';
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'admin';
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- Recriar trigger (idempotente)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
