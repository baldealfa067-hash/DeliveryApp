-- ============================================================
-- Perfis Restaurante/Loja — Parte 1b: register_as_business
-- Ficheiro separado: usa o valor 'business' do enum app_role,
-- que só pode ser usado após o commit da transação que o criou.
-- ============================================================

CREATE OR REPLACE FUNCTION public.register_as_business()
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
  VALUES (auth.uid(), 'business')
  ON CONFLICT (user_id, role) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.register_as_business() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_as_business() TO authenticated;