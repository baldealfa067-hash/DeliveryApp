-- Keep the legacy account identities and close PIN-based partner onboarding.
REVOKE EXECUTE ON FUNCTION public.admin_provision_partner(text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.admin_provision_partner_by_email(
  p_email text, p_phone text, p_name text, p_role text, p_fleet_id uuid DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_email text := lower(btrim(p_email));
  v_email_confirmed_at timestamptz;
  v_invited_at timestamptz;
  v_has_password boolean;
  v_name text := btrim(p_name);
  v_role public.app_role;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.has_role(auth.uid(), 'admin'), false) THEN
    RAISE EXCEPTION 'Apenas administradores podem adicionar parceiros' USING ERRCODE = '42501';
  END IF;
  IF v_email IS NULL OR length(v_email) > 254
    OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    OR split_part(v_email, '@', 2) = 'deliveryapp.gw'
    OR p_phone IS NULL OR p_phone !~ '^[1-9][0-9]{6,8}$'
    OR v_name IS NULL OR char_length(v_name) NOT BETWEEN 1 AND 100
    OR p_role IS NULL OR p_role NOT IN ('business', 'fleet', 'driver')
    OR (p_fleet_id IS NOT NULL AND p_role <> 'driver')
  THEN
    RAISE EXCEPTION 'Dados do parceiro inválidos' USING ERRCODE = '22023';
  END IF;

  IF p_fleet_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.fleets WHERE id = p_fleet_id
  ) THEN
    RAISE EXCEPTION 'Frota não encontrada' USING ERRCODE = '22023';
  END IF;

  SELECT u.id, u.email_confirmed_at, u.invited_at, coalesce(u.encrypted_password, '') <> ''
  INTO v_user_id, v_email_confirmed_at, v_invited_at, v_has_password
  FROM auth.users u
  WHERE lower(u.email) = v_email AND u.is_sso_user = false
  FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_email_confirmed_at IS NULL AND (v_invited_at IS NULL OR v_has_password) THEN
    RAISE EXCEPTION 'A conta já existe. Confirme o e-mail antes de ativar o parceiro'
      USING ERRCODE = '22023';
  END IF;

  v_role := p_role::public.app_role;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user_id, v_role) ON CONFLICT (user_id, role) DO NOTHING;

  IF p_role = 'business' THEN
    INSERT INTO public.profiles (user_id, name, category, phone, location, profile_type)
    VALUES (v_user_id, v_name, '', p_phone, '', 'business')
    ON CONFLICT (user_id) DO UPDATE SET
      name = excluded.name, phone = excluded.phone, profile_type = 'business'
    WHERE public.profiles.profile_type <> 'business';
  ELSIF p_role = 'fleet' THEN
    INSERT INTO public.fleets (owner_user_id, name, phone)
    VALUES (v_user_id, v_name, p_phone) ON CONFLICT (owner_user_id) DO NOTHING;
  ELSE
    INSERT INTO public.drivers (user_id, name, phone, vehicle_type, fleet_id, is_available)
    VALUES (v_user_id, v_name, p_phone, 'moto', p_fleet_id, false)
    ON CONFLICT (user_id) DO NOTHING;
    IF p_fleet_id IS NOT NULL THEN
      UPDATE public.drivers SET fleet_id = p_fleet_id, is_available = false
      WHERE user_id = v_user_id AND fleet_id IS NULL;
      IF NOT EXISTS (
        SELECT 1 FROM public.drivers WHERE user_id = v_user_id AND fleet_id = p_fleet_id
      ) THEN
        RAISE EXCEPTION 'O motorista pertence a outra frota' USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;
  RETURN v_user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_provision_partner_by_email(text, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_provision_partner_by_email(text, text, text, text, uuid) TO authenticated;
