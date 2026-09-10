-- FASE 3 (Frotas) -- as operacoes da frota (§11, §12, §13, §32).
--
-- COMO NASCE UMA CONTA DE MOTORISTA, agora que o auto-registo saiu (Adit. 1.3):
-- a pessoa cria uma conta normal de CLIENTE (telefone + PIN, o fluxo que ja'
-- existe e continua aberto a toda a gente por §9), e a frota associa-a pelo
-- numero de telefone. Nao se inventa criacao de utilizadores a partir de SQL --
-- isso exigia a admin API com service_role, que nao deve viver no frontend
-- (§49). O efeito util e' o mesmo: quem decide se alguem e' motorista da frota
-- e' a frota, nao a propria pessoa (§11).

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_fleet(
  p_name text, p_phone text, p_bairro text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_fleet_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessao'; END IF;
  IF btrim(COALESCE(p_name,  '')) = '' THEN RAISE EXCEPTION 'Nome obrigatorio'; END IF;
  IF btrim(COALESCE(p_phone, '')) = '' THEN RAISE EXCEPTION 'Telefone obrigatorio'; END IF;

  IF EXISTS (SELECT 1 FROM public.fleets WHERE owner_user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Este utilizador ja tem uma frota';
  END IF;

  INSERT INTO public.fleets (owner_user_id, name, phone, bairro)
  VALUES (auth.uid(), btrim(p_name), btrim(p_phone), p_bairro)
  RETURNING id INTO v_fleet_id;

  -- §9: ter conta de negocio nao tira o papel de cliente. Acrescenta-se `fleet`,
  -- nao se substitui nada.
  INSERT INTO public.user_roles (user_id, role)
  VALUES (auth.uid(), 'fleet')
  ON CONFLICT DO NOTHING;

  RETURN v_fleet_id;
END;
$$;

-- ---------------------------------------------------------------------------
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
BEGIN
  SELECT id INTO v_fleet_id FROM public.fleets WHERE owner_user_id = auth.uid();
  IF v_fleet_id IS NULL THEN RAISE EXCEPTION 'Sem frota: so o dono de uma frota pode adicionar motoristas'; END IF;

  SELECT user_id, name INTO v_user_id, v_nome
  FROM public.profiles WHERE phone = btrim(p_phone) LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Nao existe conta com o telefone %. A pessoa deve criar conta na app primeiro.', p_phone;
  END IF;

  SELECT id, fleet_id INTO v_driver_id, v_fleet_actual
  FROM public.drivers WHERE user_id = v_user_id;

  IF v_driver_id IS NOT NULL AND v_fleet_actual IS NOT NULL AND v_fleet_actual <> v_fleet_id THEN
    RAISE EXCEPTION 'Este motorista ja pertence a outra frota';
  END IF;

  IF v_driver_id IS NULL THEN
    INSERT INTO public.drivers (user_id, name, phone, vehicle_type, fleet_id, is_available)
    VALUES (v_user_id, COALESCE(btrim(p_name), v_nome), btrim(p_phone),
            COALESCE(p_vehicle_type, 'moto'), v_fleet_id, false)
    RETURNING id INTO v_driver_id;
  ELSE
    -- Conta legado (fleet_id NULL) a ser adoptada por esta frota.
    UPDATE public.drivers
    SET fleet_id = v_fleet_id,
        name = COALESCE(btrim(p_name), name),
        vehicle_type = COALESCE(p_vehicle_type, vehicle_type),
        updated_at = now()
    WHERE id = v_driver_id;
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (v_user_id, 'driver')
  ON CONFLICT DO NOTHING;

  RETURN v_driver_id;
END;
$$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_driver_active(p_driver_id uuid, p_active boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_fleet_id uuid;
BEGIN
  SELECT id INTO v_fleet_id FROM public.fleets WHERE owner_user_id = auth.uid();
  IF v_fleet_id IS NULL THEN RAISE EXCEPTION 'Sem frota'; END IF;

  UPDATE public.drivers SET is_available = p_active, updated_at = now()
  WHERE id = p_driver_id AND fleet_id = v_fleet_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Motorista nao pertence a esta frota'; END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Sair da frota nao apaga o motorista nem o historico de entregas (§56):
-- larga-se o vinculo, os registos ficam.
CREATE OR REPLACE FUNCTION public.remove_driver_from_fleet(p_driver_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_fleet_id uuid;
BEGIN
  SELECT id INTO v_fleet_id FROM public.fleets WHERE owner_user_id = auth.uid();
  IF v_fleet_id IS NULL THEN RAISE EXCEPTION 'Sem frota'; END IF;

  UPDATE public.drivers
  SET fleet_id = NULL, is_available = false, updated_at = now()
  WHERE id = p_driver_id AND fleet_id = v_fleet_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Motorista nao pertence a esta frota'; END IF;
END;
$$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_zone_price(p_bairro text, p_preco numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_fleet_id uuid;
BEGIN
  SELECT id INTO v_fleet_id FROM public.fleets WHERE owner_user_id = auth.uid();
  IF v_fleet_id IS NULL THEN RAISE EXCEPTION 'Sem frota'; END IF;
  IF btrim(COALESCE(p_bairro,'')) = '' THEN RAISE EXCEPTION 'Bairro obrigatorio'; END IF;
  IF p_preco IS NULL OR p_preco < 0 THEN RAISE EXCEPTION 'Preco invalido'; END IF;

  INSERT INTO public.fleet_zone_prices (fleet_id, bairro, preco)
  VALUES (v_fleet_id, btrim(p_bairro), p_preco)
  ON CONFLICT (fleet_id, bairro)
  DO UPDATE SET preco = EXCLUDED.preco, is_active = true, updated_at = now();
END;
$$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_fleet_drivers()
RETURNS TABLE(id uuid, name text, phone text, vehicle_type text, is_available boolean,
              entregas bigint, concluidas bigint, valor_entregas numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_fleet_id uuid;
BEGIN
  SELECT f.id INTO v_fleet_id FROM public.fleets f WHERE f.owner_user_id = auth.uid();
  IF v_fleet_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT dr.id, dr.name, dr.phone, dr.vehicle_type, dr.is_available,
         count(dl.id),
         count(dl.id) FILTER (WHERE dl.status = 'entregue'),
         COALESCE(sum(dl.delivery_fee) FILTER (WHERE dl.status = 'entregue'), 0)
  FROM public.drivers dr
  LEFT JOIN public.deliveries dl ON dl.driver_id = dr.id
  WHERE dr.fleet_id = v_fleet_id
  GROUP BY dr.id, dr.name, dr.phone, dr.vehicle_type, dr.is_available
  ORDER BY dr.name;
END;
$$;

-- ---------------------------------------------------------------------------
-- §32. Sem comissao nem divida: isso e' o ledger da Fase 6. §39: distinguir
-- dado registado de metrica calculada -- estes numeros sao contados na hora a
-- partir das entregas, nao ha campo de saldo nenhum a ser editado.
-- Quilometragem fica de fora de proposito (§40): o GPS ainda nao e' fiavel o
-- suficiente para apresentar valores como se fossem precisos.
CREATE OR REPLACE FUNCTION public.get_fleet_metrics()
RETURNS TABLE(fleet_id uuid, fleet_name text, motoristas bigint, motoristas_activos bigint,
              entregas bigint, concluidas bigint, pendentes bigint, valor_entregas numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_fleet_id uuid; v_nome text;
BEGIN
  SELECT f.id, f.name INTO v_fleet_id, v_nome
  FROM public.fleets f WHERE f.owner_user_id = auth.uid();
  IF v_fleet_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT v_fleet_id, v_nome,
    (SELECT count(*) FROM public.drivers WHERE drivers.fleet_id = v_fleet_id),
    (SELECT count(*) FROM public.drivers WHERE drivers.fleet_id = v_fleet_id AND is_available),
    (SELECT count(*) FROM public.deliveries WHERE deliveries.fleet_id = v_fleet_id),
    (SELECT count(*) FROM public.deliveries WHERE deliveries.fleet_id = v_fleet_id AND status = 'entregue'),
    (SELECT count(*) FROM public.deliveries WHERE deliveries.fleet_id = v_fleet_id AND status = 'pendente'),
    (SELECT COALESCE(sum(delivery_fee), 0) FROM public.deliveries
      WHERE deliveries.fleet_id = v_fleet_id AND status = 'entregue');
END;
$$;

-- ---------------------------------------------------------------------------
-- A licao de 20260909213622: revogar de PUBLIC, nunca de `anon`.
REVOKE EXECUTE ON FUNCTION public.create_fleet(text, text, text)          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.add_driver_to_fleet(text, text, text)   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_driver_active(uuid, boolean)        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.remove_driver_from_fleet(uuid)          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.upsert_zone_price(text, numeric)        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_fleet_drivers()                     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_fleet_metrics()                     FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_fleet(text, text, text)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_driver_to_fleet(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_driver_active(uuid, boolean)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_driver_from_fleet(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_zone_price(text, numeric)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_fleet_drivers()                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_fleet_metrics()                   TO authenticated;
