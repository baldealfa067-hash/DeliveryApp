-- CORRECCAO -- add_driver_to_fleet nunca encontrava ninguem.
--
-- Procurava a conta em `profiles.phone`. Mas uma conta criada por telefone+PIN
-- -- que e' como TODOS os clientes se registam, e portanto como todo o
-- motorista tera' conta -- nasce com `profiles.phone = ''`: o trigger
-- handle_new_user insere string vazia nessa coluna. O telefone vive noutro
-- sitio: em `auth.users.email`, na forma sintetica `c<numero>@deliveryapp.gw`
-- criada por clientEmail() em src/lib/clientAuth.ts.
--
-- Medido: das contas @deliveryapp.gw existentes, 5 em 5 tem profiles.phone
-- vazio. A funcao teria dado sempre 'Nao existe conta com o telefone X'.
--
-- Isto nao apareceu no teste de ponta a ponta da Fase 3 porque ai' usei o
-- telefone de um perfil de NEGOCIO, que tem `profiles.phone` preenchido a mao
-- no ecra de edicao. O caso real -- uma pessoa que se registou por telefone --
-- e' precisamente o que falhava. Apanhado ao escrever o guia de teste manual.
--
-- NORMALIZACAO: replica normalizePhone() de src/lib/clientAuth.ts. So' digitos;
-- prefixo 00245 cai sempre; 245 cai apenas quando o total da' 12 digitos (um
-- numero local de 9 pode comecar por 245 e nao deve ser truncado); zeros a'
-- esquerda caem. As duas implementacoes tem de andar juntas.

CREATE OR REPLACE FUNCTION public.add_driver_to_fleet(
  p_phone text, p_name text DEFAULT NULL, p_vehicle_type text DEFAULT 'moto'
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_fleet_id uuid;
  v_user_id uuid;
  v_nome text;
  v_driver_id uuid;
  v_fleet_actual uuid;
  v_digits text;
  v_email text;
BEGIN
  SELECT id INTO v_fleet_id FROM public.fleets WHERE owner_user_id = auth.uid();
  IF v_fleet_id IS NULL THEN
    RAISE EXCEPTION 'Sem frota: so o dono de uma frota pode adicionar motoristas';
  END IF;

  -- normalizePhone()
  v_digits := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  IF v_digits LIKE '00245%' THEN
    v_digits := substr(v_digits, 6);
  ELSIF length(v_digits) = 12 AND v_digits LIKE '245%' THEN
    v_digits := substr(v_digits, 4);
  END IF;
  v_digits := regexp_replace(v_digits, '^0+', '');

  IF length(v_digits) < 7 OR length(v_digits) > 9 THEN
    RAISE EXCEPTION 'Telefone invalido: %', p_phone;
  END IF;

  v_email := 'c' || v_digits || '@deliveryapp.gw';

  -- 1) conta criada por telefone+PIN (o caso normal)
  SELECT u.id INTO v_user_id FROM auth.users u WHERE u.email = v_email;

  -- 2) conta com email real que preencheu o telefone no perfil (restaurantes,
  --    frotas) -- compara-se ja' normalizado dos dois lados.
  IF v_user_id IS NULL THEN
    SELECT p.user_id INTO v_user_id
    FROM public.profiles p
    WHERE regexp_replace(regexp_replace(regexp_replace(COALESCE(p.phone,''), '\D', '', 'g'),
                                        '^(00245|245)', ''), '^0+', '') = v_digits
      AND COALESCE(p.phone, '') <> ''
    LIMIT 1;
  END IF;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Nao existe conta com o telefone %. A pessoa deve criar conta na app primeiro.', v_digits;
  END IF;

  SELECT p.name INTO v_nome FROM public.profiles p WHERE p.user_id = v_user_id;

  SELECT id, fleet_id INTO v_driver_id, v_fleet_actual
  FROM public.drivers WHERE user_id = v_user_id;

  IF v_driver_id IS NOT NULL AND v_fleet_actual IS NOT NULL AND v_fleet_actual <> v_fleet_id THEN
    RAISE EXCEPTION 'Este motorista ja pertence a outra frota';
  END IF;

  IF v_driver_id IS NULL THEN
    INSERT INTO public.drivers (user_id, name, phone, vehicle_type, fleet_id, is_available)
    VALUES (v_user_id, COALESCE(NULLIF(btrim(p_name), ''), v_nome, 'Motorista'), v_digits,
            COALESCE(p_vehicle_type, 'moto'), v_fleet_id, false)
    RETURNING id INTO v_driver_id;
  ELSE
    UPDATE public.drivers
    SET fleet_id = v_fleet_id,
        name = COALESCE(NULLIF(btrim(p_name), ''), name),
        vehicle_type = COALESCE(p_vehicle_type, vehicle_type),
        updated_at = now()
    WHERE id = v_driver_id;
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (v_user_id, 'driver')
  ON CONFLICT DO NOTHING;

  RETURN v_driver_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.add_driver_to_fleet(text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.add_driver_to_fleet(text, text, text) TO authenticated;
