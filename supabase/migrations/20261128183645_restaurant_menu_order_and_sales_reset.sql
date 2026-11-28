ALTER TABLE public.menu_categories ADD COLUMN display_position integer
  CHECK (display_position > 0);

CREATE FUNCTION public.save_restaurant_menu_order(p_business_id uuid, p_category_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  updated_count integer;
BEGIN
  IF p_category_ids IS NULL
    OR cardinality(p_category_ids) <> (SELECT count(*) FROM public.menu_categories WHERE business_id = p_business_id) THEN
    RAISE EXCEPTION 'A lista de categorias mudou' USING ERRCODE = '22023';
  END IF;

  WITH positions AS (
    SELECT id, position FROM unnest(p_category_ids) WITH ORDINALITY AS item(id, position)
  )
  UPDATE public.menu_categories c
  SET display_position = positions.position::integer
  FROM positions
  WHERE c.business_id = p_business_id AND c.id = positions.id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> cardinality(p_category_ids) THEN
    RAISE EXCEPTION 'A lista de categorias mudou' USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.save_restaurant_menu_order(uuid,uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_restaurant_menu_order(uuid,uuid[]) TO authenticated;

CREATE TABLE public.restaurant_operation_start (
  business_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL
);
ALTER TABLE public.restaurant_operation_start ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.restaurant_operation_start FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.reset_restaurant_operation(p_business_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM 1 FROM public.profiles p
  WHERE p.id = p_business_id AND p.user_id = auth.uid() AND p.profile_type = 'business'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.business_id = p_business_id AND o.status NOT IN ('concluido', 'entregue', 'cancelado')
  ) THEN
    RAISE EXCEPTION 'Existem pedidos em andamento' USING ERRCODE = 'PT409';
  END IF;

  INSERT INTO public.restaurant_operation_start (business_id, started_at)
  VALUES (p_business_id, clock_timestamp())
  ON CONFLICT (business_id) DO UPDATE SET started_at = excluded.started_at;
END;
$$;

CREATE FUNCTION public.get_restaurant_operation_order_count(p_business_id uuid)
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_business_id AND p.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT count(*) FROM public.orders o WHERE o.business_id = p_business_id
      AND o.created_at >= coalesce((
        SELECT r.started_at FROM public.restaurant_operation_start r WHERE r.business_id = p_business_id
      ), '-infinity'::timestamptz)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reset_restaurant_operation(uuid),
  public.get_restaurant_operation_order_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_restaurant_operation(uuid),
  public.get_restaurant_operation_order_count(uuid) TO authenticated;

DO $$
DECLARE
  target record;
  definition text;
  updated_definition text;
  after_start constant text := 'o.created_at >= coalesce((
    SELECT r.started_at FROM public.restaurant_operation_start r WHERE r.business_id = p_business_id
  ), ''-infinity''::timestamptz)';
BEGIN
  FOR target IN SELECT * FROM (VALUES
    ('get_business_orders(uuid,text)', 'WHERE', true),
    ('get_business_sales_stats(uuid)', 'WHERE', false),
    ('get_business_daily_sales(uuid,integer)', 'ON', false)
  ) AS routines(signature, clause, keep_active)
  LOOP
    definition := pg_get_functiondef(('public.' || target.signature)::regprocedure);
    updated_definition := replace(definition, target.clause || ' o.business_id = p_business_id',
      target.clause || ' o.business_id = p_business_id AND (' || after_start ||
      CASE WHEN target.keep_active THEN ' OR o.status NOT IN (''concluido'', ''entregue'', ''cancelado'')' ELSE '' END || ')');
    IF updated_definition = definition THEN
      RAISE EXCEPTION 'Filtro de restaurante não encontrado em %', target.signature;
    END IF;
    EXECUTE updated_definition;
  END LOOP;
END;
$$;
