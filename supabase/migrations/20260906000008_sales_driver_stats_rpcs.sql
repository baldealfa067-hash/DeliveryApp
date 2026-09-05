-- ============================================================
-- RPCs for Business Sales Dashboard & Driver Delivery Stats
-- ============================================================

-- 1. Business sales summary (today, 7 days, month)
CREATE OR REPLACE FUNCTION public.get_business_sales_stats(p_business_id uuid)
RETURNS TABLE(
  today_total numeric,
  today_count bigint,
  week_total numeric,
  week_count bigint,
  month_total numeric,
  month_count bigint,
  avg_ticket numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  -- RLS: verify caller owns this business
  SELECT user_id INTO v_owner FROM public.profiles WHERE id = p_business_id;
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(SUM(CASE WHEN o.created_at >= CURRENT_DATE THEN o.total ELSE 0 END), 0)::numeric AS today_total,
    COUNT(CASE WHEN o.created_at >= CURRENT_DATE THEN 1 END) AS today_count,
    COALESCE(SUM(CASE WHEN o.created_at >= CURRENT_DATE - INTERVAL '6 days' THEN o.total ELSE 0 END), 0)::numeric AS week_total,
    COUNT(CASE WHEN o.created_at >= CURRENT_DATE - INTERVAL '6 days' THEN 1 END) AS week_count,
    COALESCE(SUM(CASE WHEN o.created_at >= date_trunc('month', CURRENT_DATE) THEN o.total ELSE 0 END), 0)::numeric AS month_total,
    COUNT(CASE WHEN o.created_at >= date_trunc('month', CURRENT_DATE) THEN 1 END) AS month_count,
    COALESCE(ROUND(AVG(o.total), 0), 0)::numeric AS avg_ticket
  FROM public.orders o
  WHERE o.business_id = p_business_id
    AND o.status IN ('pronto', 'aguardando_motorista', 'motorista_encontrado', 'pedido_recolhido', 'a_caminho', 'entregue', 'concluido');
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_business_sales_stats(uuid) TO authenticated;

-- 2. Business daily sales (for chart)
CREATE OR REPLACE FUNCTION public.get_business_daily_sales(p_business_id uuid, p_days integer DEFAULT 7)
RETURNS TABLE(
  day date,
  total numeric,
  order_count bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  SELECT user_id INTO v_owner FROM public.profiles WHERE id = p_business_id;
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT
    d.day,
    COALESCE(SUM(o.total), 0)::numeric AS total,
    COUNT(o.id) AS order_count
  FROM generate_series(CURRENT_DATE - (p_days - 1) * INTERVAL '1 day', CURRENT_DATE, '1 day') AS d(day)
  LEFT JOIN public.orders o
    ON o.business_id = p_business_id
    AND o.created_at::date = d.day
    AND o.status IN ('pronto', 'aguardando_motorista', 'motorista_encontrado', 'pedido_recolhido', 'a_caminho', 'entregue', 'concluido')
  GROUP BY d.day
  ORDER BY d.day;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_business_daily_sales(uuid, integer) TO authenticated;

-- 3. Driver delivery summary (today, 7 days, month)
CREATE OR REPLACE FUNCTION public.get_driver_delivery_stats(p_driver_id uuid)
RETURNS TABLE(
  today_count bigint,
  today_distance numeric,
  week_count bigint,
  week_distance numeric,
  month_count bigint,
  month_distance numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  SELECT user_id INTO v_owner FROM public.drivers WHERE id = p_driver_id;
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(CASE WHEN d.delivered_at >= CURRENT_DATE THEN 1 END) AS today_count,
    COALESCE(SUM(CASE WHEN d.delivered_at >= CURRENT_DATE THEN d.distance_km ELSE 0 END), 0)::numeric AS today_distance,
    COUNT(CASE WHEN d.delivered_at >= CURRENT_DATE - INTERVAL '6 days' THEN 1 END) AS week_count,
    COALESCE(SUM(CASE WHEN d.delivered_at >= CURRENT_DATE - INTERVAL '6 days' THEN d.distance_km ELSE 0 END), 0)::numeric AS week_distance,
    COUNT(CASE WHEN d.delivered_at >= date_trunc('month', CURRENT_DATE) THEN 1 END) AS month_count,
    COALESCE(SUM(CASE WHEN d.delivered_at >= date_trunc('month', CURRENT_DATE) THEN d.distance_km ELSE 0 END), 0)::numeric AS month_distance
  FROM public.deliveries d
  WHERE d.driver_id = p_driver_id
    AND d.status = 'entregue';
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_driver_delivery_stats(uuid) TO authenticated;

-- 4. Driver daily stats (for chart)
CREATE OR REPLACE FUNCTION public.get_driver_daily_stats(p_driver_id uuid, p_days integer DEFAULT 7)
RETURNS TABLE(
  day date,
  delivery_count bigint,
  distance numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  SELECT user_id INTO v_owner FROM public.drivers WHERE id = p_driver_id;
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT
    ds.day,
    COUNT(d.id) AS delivery_count,
    COALESCE(SUM(d.distance_km), 0)::numeric AS distance
  FROM generate_series(CURRENT_DATE - (p_days - 1) * INTERVAL '1 day', CURRENT_DATE, '1 day') AS ds(day)
  LEFT JOIN public.deliveries d
    ON d.driver_id = p_driver_id
    AND d.status = 'entregue'
    AND d.delivered_at::date = ds.day
  GROUP BY ds.day
  ORDER BY ds.day;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_driver_daily_stats(uuid, integer) TO authenticated;
