CREATE FUNCTION public.register_independent_driver(p_name text, p_phone text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_name text := btrim(p_name);
  v_driver_id uuid;
BEGIN
  IF v_user_id IS NULL OR p_phone IS NULL OR p_phone !~ '^[1-9][0-9]{6,8}$'
    OR NOT EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = v_user_id AND lower(u.email) = ('c' || p_phone || '@deliveryapp.gw')
    )
  THEN
    RAISE EXCEPTION 'É necessário entrar com a conta deste número de telefone'
      USING ERRCODE = '42501';
  END IF;

  IF v_name IS NULL OR char_length(v_name) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Indique um nome válido' USING ERRCODE = '22023';
  END IF;

  -- Keep any existing driver record, especially a fleet association.
  INSERT INTO public.drivers (user_id, name, phone, vehicle_type, is_available, bornaal_id)
  VALUES (
    v_user_id, v_name, p_phone, 'moto', false,
    (SELECT p.bornaal_id FROM public.profiles p WHERE p.user_id = v_user_id LIMIT 1)
  )
  ON CONFLICT (user_id) DO NOTHING
  RETURNING id INTO v_driver_id;

  IF v_driver_id IS NULL THEN
    SELECT d.id INTO STRICT v_driver_id FROM public.drivers d WHERE d.user_id = v_user_id;
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user_id, 'driver')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN v_driver_id;
END;
$$;

REVOKE ALL ON FUNCTION public.register_independent_driver(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_independent_driver(text, text) TO authenticated;
