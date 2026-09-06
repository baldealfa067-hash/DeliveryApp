-- ============================================================
-- Uma conta sem profile_type declarado passa a ser CLIENTE, não restaurante.
-- ============================================================
--
-- handle_new_user tinha:
--   COALESCE(NULLIF(btrim(raw_user_meta_data->>'profile_type'),''), 'business')
--
-- Ou seja: quando o registo não declarava o tipo, a conta ganhava o papel
-- 'business'. O registo de cliente por telefone não declarava nada, portanto
-- todas essas contas ficavam com {business, client} — e o destino pós-login,
-- que cai para user_roles quando profiles.profile_type não é 'business',
-- encontrava 'business' e mandava o cliente para o painel do restaurante.
--
-- Medido antes da correção: das contas sem profile_type na metadata, 5 em 5
-- tinham papel business. Das que declaravam 'client', 0 em 5.
--
-- O valor por defeito passa a ser o de menor privilégio. Quem quer ser
-- restaurante declara-o no registo; quem não declara nada é cliente.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_profile_type text;
  v_role app_role;
BEGIN
  BEGIN
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
    -- Menor privilégio por defeito: sem declaração, é cliente.
    v_profile_type := COALESCE(NULLIF(btrim(NEW.raw_user_meta_data->>'profile_type'), ''), 'client');
    -- DeliveryApp só usa business/client; mapear provider/beleza legados para client,
    -- que é o papel sem acesso a painéis de gestão.
    IF v_profile_type IN ('provider', 'beleza') THEN
      v_profile_type := 'client';
    END IF;
    BEGIN
      v_role := v_profile_type::app_role;
    EXCEPTION WHEN others THEN
      v_role := 'client';
    END;
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, v_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'handle_new_user role insert failed: %', SQLERRM;
  END;

  RETURN NEW;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'handle_new_user failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- Limpar as contas já afetadas.
--
-- Só as de telefone (@deliveryapp.gw): essas nascem sempre do registo de
-- cliente e nunca podem ser um restaurante legítimo, porque o registo de
-- restaurante usa email real. As contas com email real não são tocadas.
-- ------------------------------------------------------------
DELETE FROM public.user_roles r
USING auth.users u
WHERE r.user_id = u.id
  AND r.role = 'business'
  AND u.email LIKE '%@deliveryapp.gw';
