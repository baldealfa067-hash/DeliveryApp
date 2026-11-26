CREATE TABLE public.restaurant_team (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  permissions text[] NOT NULL CHECK (
    permissions <@ ARRAY['orders','finance','commission']
  )
);
CREATE INDEX restaurant_team_business_idx ON public.restaurant_team(business_id);
ALTER TABLE public.restaurant_team ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.restaurant_team FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.has_restaurant_permission(p_business_id uuid, p_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(public.is_business_owner(p_business_id), false) OR EXISTS (
    SELECT 1 FROM public.restaurant_team r
    WHERE r.business_id = p_business_id AND r.user_id = (SELECT auth.uid())
      AND p_permission = ANY(r.permissions)
  );
$$;

CREATE FUNCTION public.get_my_restaurant_team_access()
RETURNS TABLE(business_id uuid, permissions text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT r.business_id, r.permissions FROM public.restaurant_team r WHERE r.user_id = (SELECT auth.uid()) AND cardinality(r.permissions) > 0;
$$;

CREATE FUNCTION public.list_restaurant_team(p_business_id uuid)
RETURNS TABLE(user_id uuid, email text, permissions text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT r.user_id, u.email::text, r.permissions
  FROM public.restaurant_team r JOIN auth.users u ON u.id = r.user_id
  WHERE r.business_id = p_business_id AND public.is_business_owner(p_business_id)
  ORDER BY u.email;
$$;

CREATE FUNCTION public.set_restaurant_team_access(p_business_id uuid, p_email text, p_permissions text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user uuid;
BEGIN
  IF NOT coalesce(public.is_business_owner(p_business_id), false)
    OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_business_id AND p.profile_type = 'business') THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;
  SELECT id INTO v_user FROM auth.users
  WHERE lower(email) = lower(btrim(p_email)) AND email_confirmed_at IS NOT NULL;
  IF v_user IS NULL OR v_user = auth.uid() THEN
    RAISE EXCEPTION 'Indica o e-mail confirmado de uma conta da equipa.';
  END IF;

  IF p_permissions IS NULL OR NOT (p_permissions <@ ARRAY['orders','finance','commission']) THEN
    RAISE EXCEPTION 'Permissões inválidas.';
  END IF;
  IF lower(btrim(p_email)) ~ '^r[1-9][0-9]{6,8}@deliveryapp[.]gw$' THEN
    UPDATE public.restaurant_team SET permissions = p_permissions
    WHERE user_id = v_user AND business_id = p_business_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Funcionário não pertence a este restaurante.'; END IF;
    RETURN;
  END IF;
  IF cardinality(p_permissions) = 0 THEN
    DELETE FROM public.restaurant_team WHERE user_id = v_user AND business_id = p_business_id;
    RETURN;
  END IF;

  INSERT INTO public.restaurant_team(user_id, business_id, permissions)
  VALUES (v_user, p_business_id, p_permissions)
  ON CONFLICT (user_id) DO UPDATE SET permissions = excluded.permissions
  WHERE restaurant_team.business_id = excluded.business_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esta conta já tem acesso a outro restaurante.'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.has_restaurant_permission(uuid,text), public.get_my_restaurant_team_access(),
  public.list_restaurant_team(uuid), public.set_restaurant_team_access(uuid,text,text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_restaurant_permission(uuid,text), public.get_my_restaurant_team_access(),
  public.list_restaurant_team(uuid), public.set_restaurant_team_access(uuid,text,text[]) TO authenticated;

-- Keep each existing RPC and its grants. Change only its restaurant-specific guard.
DO $$
DECLARE
  edit record;
  original text;
  modified text;
BEGIN
  FOR edit IN SELECT * FROM (VALUES
    ('get_business_orders(uuid,text)', 'public.is_business_owner(p_business_id)', 'public.has_restaurant_permission(p_business_id, ''orders'')'),
    ('create_manual_order(uuid,jsonb,text,text,text,text,text,text,text,boolean,double precision,double precision)', 'public.is_business_owner(p_business_id)', 'public.has_restaurant_permission(p_business_id, ''orders'')'),
    ('create_manual_order_internal(uuid,jsonb,text,text,text,text,text,text,text,boolean)', 'public.is_business_owner(p_business_id)', 'public.has_restaurant_permission(p_business_id, ''orders'')'),
    ('update_order_status(uuid,text,text,integer)', $old$v_is_owner := EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_business_id AND p.user_id = auth.uid()
  );$old$, 'v_is_owner := public.has_restaurant_permission(v_business_id, ''orders'');'),
    ('reoffer_delivery(uuid)', 'p.user_id = auth.uid()', 'public.has_restaurant_permission(o.business_id, ''orders'')'),
    ('get_order_history(uuid)', 'p.user_id = auth.uid()', 'public.has_restaurant_permission(o.business_id, ''orders'')'),
    ('get_delivery_confirmation_pin(uuid)', 'public.is_business_owner(o.business_id)', 'public.has_restaurant_permission(o.business_id, ''orders'')'),
    ('get_order_photo_proof(uuid,text)', 'public.is_business_owner(o.business_id)', 'public.has_restaurant_permission(o.business_id, ''orders'')'),
    ('get_business_sales_stats(uuid)', 'v_owner IS NULL OR v_owner IS DISTINCT FROM auth.uid()', 'NOT public.has_restaurant_permission(p_business_id, ''finance'')'),
    ('get_business_daily_sales(uuid,integer)', 'v_owner IS NULL OR v_owner IS DISTINCT FROM auth.uid()', 'NOT public.has_restaurant_permission(p_business_id, ''finance'')'),
    ('get_business_commission(uuid)', 'v_owner IS DISTINCT FROM auth.uid()', 'NOT public.has_restaurant_permission(p_business_id, ''commission'')'),
    ('get_business_cash_settlements(uuid)', 'public.is_business_owner(p_business_id)', 'public.has_restaurant_permission(p_business_id, ''finance'')'),
    ('confirm_cash_settlement(uuid)', 'public.is_business_owner(a.business_id)', 'public.has_restaurant_permission(a.business_id, ''finance'')'),
    ('contest_cash_settlement(uuid,text)', 'public.is_business_owner(a.business_id)', 'public.has_restaurant_permission(a.business_id, ''finance'')')
  ) AS edits(signature, old_clause, new_clause)
  LOOP
    original := pg_get_functiondef(('public.' || edit.signature)::regprocedure);
    modified := replace(original, edit.old_clause, edit.new_clause);
    IF modified = original AND edit.signature = 'get_business_sales_stats(uuid)' THEN
      modified := replace(original, 'v_owner IS NULL OR v_owner <> auth.uid()', edit.new_clause);
    END IF;
    IF modified = original THEN RAISE EXCEPTION 'Guarda não encontrada em %', edit.signature; END IF;
    EXECUTE modified;
  END LOOP;
END;
$$;

-- Decisions on an individual payment belong to the order team.
CREATE OR REPLACE FUNCTION public.validate_order_payment(p_order_id uuid, p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('validado', 'rejeitado') THEN RAISE EXCEPTION 'Estado inválido'; END IF;
  UPDATE public.orders SET payment_status = p_status WHERE id = p_order_id
    AND public.has_restaurant_permission(business_id, 'orders');
  IF NOT FOUND THEN RAISE EXCEPTION 'Acesso negado'; END IF;
END;
$$;

CREATE POLICY "Restaurant commission team reads payments" ON public.commission_payments
FOR SELECT TO authenticated
USING (business_id IS NOT NULL AND public.has_restaurant_permission(business_id, 'commission'));

CREATE POLICY "Restaurant commission team submits payments" ON public.commission_payments
FOR INSERT TO authenticated
WITH CHECK (business_id IS NOT NULL AND fleet_id IS NULL AND status = 'pendente'
  AND public.has_restaurant_permission(business_id, 'commission'));

DO $$
DECLARE original text;
BEGIN
  original := pg_get_functiondef('public.pode_ouvir_nota_voz(text)'::regprocedure);
  EXECUTE replace(original,
    'EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = o.business_id AND p.user_id = auth.uid())',
    'public.has_restaurant_permission(o.business_id, ''orders'')');
END;
$$;

CREATE OR REPLACE FUNCTION public.pode_ver_comprovativo_comissao(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    split_part(p_name, '/', 1) = auth.uid()::text OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.commission_payments c
      WHERE c.proof_url = p_name AND public.has_restaurant_permission(c.business_id, 'commission'))
  );
$$;

ALTER FUNCTION public.get_business_commission(uuid) RENAME TO get_business_commission_internal;
REVOKE ALL ON FUNCTION public.get_business_commission_internal(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.get_business_commission(p_business_id uuid)
RETURNS TABLE(total_sales numeric, commission_rate numeric, commission_due numeric, commission_paid numeric,
  commission_balance numeric, food_receivable numeric, delivery_payable numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT c.total_sales, c.commission_rate, c.commission_due, c.commission_paid, c.commission_balance,
    CASE WHEN public.has_restaurant_permission(p_business_id, 'finance') OR public.has_role(auth.uid(), 'admin')
      THEN c.food_receivable END,
    CASE WHEN public.has_restaurant_permission(p_business_id, 'finance') OR public.has_role(auth.uid(), 'admin')
      THEN c.delivery_payable END
  FROM public.get_business_commission_internal(p_business_id) c;
$$;
REVOKE ALL ON FUNCTION public.get_business_commission(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_business_commission(uuid) TO authenticated, service_role;

CREATE FUNCTION public.provision_restaurant_staff_access(
  p_owner_id uuid, p_business_id uuid, p_user_id uuid, p_permissions text[]
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_business_id AND p.user_id = p_owner_id AND p.profile_type = 'business'
  ) OR NOT EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id = p_user_id AND u.email ~ '^r[1-9][0-9]{6,8}@deliveryapp[.]gw$'
  ) THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  IF p_permissions IS NULL OR cardinality(p_permissions) = 0 THEN
    RAISE EXCEPTION 'Permissões inválidas.';
  END IF;
  INSERT INTO public.restaurant_team(user_id, business_id, permissions)
  VALUES (p_user_id, p_business_id, p_permissions);
END;
$$;
REVOKE ALL ON FUNCTION public.provision_restaurant_staff_access(uuid,uuid,uuid,text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_restaurant_staff_access(uuid,uuid,uuid,text[]) TO service_role;
