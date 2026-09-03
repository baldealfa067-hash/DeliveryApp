-- ============================================================
-- Sistema de autenticação CLIENTE
-- - Adiciona 'client' ao CHECK constraint de profiles.profile_type
-- - Cria register_as_client() RPC
-- - Cria claim_anonymous_requests(p_phone) para vincular pedidos anónimos
-- Versão IDEMPOTENTE — pode correr várias vezes
-- ============================================================

-- 1. Atualizar CHECK constraint de profiles.profile_type para aceitar 'client'
DO $$
DECLARE c text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND contype = 'c'
      AND conname = 'profiles_profile_type_check'
      AND pg_get_constraintdef(oid) LIKE '%client%'
  ) THEN
    SELECT conname INTO c FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND contype = 'c'
      AND conname = 'profiles_profile_type_check';
    IF c IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', c);
    END IF;
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_profile_type_check
      CHECK (profile_type IN ('provider', 'business', 'beleza', 'client'));
  END IF;
END $$;

-- 2. RPC: atribui o role 'client' ao utilizador autenticado
CREATE OR REPLACE FUNCTION public.register_as_client()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (auth.uid(), 'client')
  ON CONFLICT (user_id, role) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.register_as_client() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_as_client() TO authenticated;

-- 3. RPC: vincula pedidos anónimos (user_id IS NULL) a um utilizador autenticado
--    Baseado no phone number do pedido vs phone do perfil do utilizador
CREATE OR REPLACE FUNCTION public.claim_anonymous_requests()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_phone text;
  v_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  -- Buscar telefone do perfil do utilizador
  SELECT phone INTO v_phone
  FROM public.profiles
  WHERE user_id = v_user_id
  LIMIT 1;
  -- Se não tem telefone no perfil, tentar do raw_user_meta_data
  IF v_phone IS NULL OR v_phone = '' THEN
    v_phone := NULL;
  END IF;
  IF v_phone IS NULL THEN
    RETURN 0;
  END IF;
  -- Normalizar telefone (remover espaços, traços, parênteses)
  v_phone := regexp_replace(v_phone, '[^0-9+]', '', 'g');
  -- Vincular pedidos onde o requester_phone (normalizado) coincide
  UPDATE public.service_requests
  SET user_id = v_user_id
  WHERE user_id IS NULL
    AND regexp_replace(COALESCE(requester_phone, ''), '[^0-9+]', '', 'g') = v_phone;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_anonymous_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_anonymous_requests() TO authenticated;
