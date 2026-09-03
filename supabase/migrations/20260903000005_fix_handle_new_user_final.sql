-- ============================================================
-- FIX: handle_new_user falhava e bloqueava signup (500 Database error)
-- Causa: trigger inseria em profiles que disparava trg_assign_bornaal_id
-- duplicado + não tinha EXCEPTION global, qualquer erro abortava o INSERT em auth.users
-- Solução: envolver tudo em EXCEPTION, deduplicar trigger, garantir que signup nunca falha
-- ============================================================

-- 1. Remover trigger duplicado em profiles (havia 2 com mesmo nome)
DROP TRIGGER IF EXISTS trg_assign_bornaal_id ON public.profiles;

-- 2. Garantir que assign_bornaal_id existe e é idempotente
CREATE OR REPLACE FUNCTION public.assign_bornaal_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.bornaal_id IS NULL OR btrim(NEW.bornaal_id) = '' THEN
    NEW.bornaal_id := public.generate_bornaal_id();
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN
  -- Se gerar falhar, não bloqueia o insert do perfil
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_assign_bornaal_id
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.assign_bornaal_id();

-- 3. Recriar handle_new_user robusto — nunca deve levantar exceção para auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_profile_type text;
  v_role app_role;
BEGIN
  BEGIN
    -- Criar perfil
    INSERT INTO public.profiles (user_id, name, category, phone, location)
    VALUES (
      NEW.id,
      COALESCE(NULLIF(btrim(NEW.raw_user_meta_data->>'name'), ''), split_part(NEW.email, '@', 1), 'Utilizador'),
      '',
      '',
      ''
    )
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'handle_new_user profile insert failed: %', SQLERRM;
  END;

  BEGIN
    v_profile_type := COALESCE(NULLIF(btrim(NEW.raw_user_meta_data->>'profile_type'), ''), 'business');
    -- DeliveryApp só usa business/client; mapear provider/beleza legados para business
    IF v_profile_type IN ('provider', 'beleza') THEN
      v_profile_type := 'business';
    END IF;
    BEGIN
      v_role := v_profile_type::app_role;
    EXCEPTION WHEN others THEN
      v_role := 'business';
    END;
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, v_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'handle_new_user role insert failed: %', SQLERRM;
  END;

  RETURN NEW;
EXCEPTION WHEN others THEN
  -- Nunca bloquear o signup por erro no trigger
  RAISE NOTICE 'handle_new_user failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- Recriar trigger em auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Testar que não há triggers duplicados
-- (verificação: deve haver 1 trg_assign_bornaal_id)
