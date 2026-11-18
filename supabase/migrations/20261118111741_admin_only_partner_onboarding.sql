-- Public signup always creates a client regardless of submitted metadata.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, name, category, phone, location)
  VALUES (
    NEW.id,
    coalesce(nullif(btrim(NEW.raw_user_meta_data->>'name'), ''), split_part(NEW.email, '@', 1), 'Utilizador'),
    '', '', ''
  )
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'client')
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM PUBLIC, anon, authenticated;
REVOKE INSERT ON public.fleets FROM PUBLIC, anon, authenticated;
REVOKE INSERT ON public.drivers FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION
  public.register_as_business(), public.register_as_beleza(), public.register_as_provider(),
  public.register_as_driver(text, text, text), public.register_independent_driver(text, text),
  public.create_fleet(text, text, text), public.add_driver_to_fleet(text, text, text)
FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.require_approved_partner_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.profile_type IN ('business', 'beleza')
    AND NOT public.has_role(NEW.user_id, NEW.profile_type::public.app_role)
    AND NOT coalesce(public.has_role(auth.uid(), 'admin'), false)
  THEN
    RAISE EXCEPTION 'O administrador precisa de ativar este tipo de perfil'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.require_approved_partner_profile() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER require_approved_partner_profile
BEFORE INSERT OR UPDATE OF profile_type, user_id ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.require_approved_partner_profile();

-- Returns NULL if Auth does not yet have the phone account. An approved
-- administrator can then create it using the Auth Admin API and retry.
CREATE FUNCTION public.admin_provision_partner(
  p_phone text, p_name text, p_role text, p_fleet_id uuid DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_name text := btrim(p_name);
  v_role public.app_role;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.has_role(auth.uid(), 'admin'), false) THEN
    RAISE EXCEPTION 'Apenas administradores podem adicionar parceiros' USING ERRCODE = '42501';
  END IF;
  IF p_phone IS NULL OR p_phone !~ '^[1-9][0-9]{6,8}$'
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

  SELECT u.id INTO v_user_id FROM auth.users u
  WHERE lower(u.email) = 'c' || p_phone || '@deliveryapp.gw'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

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
REVOKE ALL ON FUNCTION public.admin_provision_partner(text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_provision_partner(text, text, text, uuid) TO authenticated;
