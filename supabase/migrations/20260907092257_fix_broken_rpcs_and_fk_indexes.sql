-- 1. get_business_daily_sales: generate_series(date + interval, ...) devolve
--    timestamp, mas a funcao declara `day date` -> "structure of query does not
--    match function result type" em todas as chamadas. O grafico de vendas
--    diarias nunca chegou a funcionar. Cast explicito para date.
CREATE OR REPLACE FUNCTION public.get_business_daily_sales(p_business_id uuid, p_days integer DEFAULT 7)
 RETURNS TABLE(day date, total numeric, order_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid;
BEGIN
  SELECT user_id INTO v_owner FROM public.profiles WHERE id = p_business_id;
  IF v_owner IS NULL OR v_owner IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT
    d.day::date,
    COALESCE(SUM(o.total), 0)::numeric AS total,
    COUNT(o.id) AS order_count
  FROM generate_series(CURRENT_DATE - (p_days - 1) * INTERVAL '1 day', CURRENT_DATE, '1 day') AS d(day)
  LEFT JOIN public.orders o
    ON o.business_id = p_business_id
    AND o.created_at::date = d.day::date
    AND o.status IN ('pronto', 'aguardando_motorista', 'motorista_encontrado', 'pedido_recolhido', 'a_caminho', 'entregue', 'concluido')
  GROUP BY d.day
  ORDER BY d.day;
END;
$function$;

-- 2. lookup_by_bornaal_id / search_bornaal_id liam p.full_name e p.avatar_url,
--    colunas que nao existem em profiles (chamam-se name e photo_url). Davam
--    erro em qualquer chamada. O alias mantem o formato de retorno, portanto o
--    frontend nao precisa de mudar.
CREATE OR REPLACE FUNCTION public.lookup_by_bornaal_id(p_bornaal_id text)
 RETURNS TABLE(user_id uuid, bornaal_id text, full_name text, avatar_url text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT p.user_id, p.bornaal_id, p.name AS full_name, p.photo_url AS avatar_url
  FROM public.profiles p
  WHERE p.bornaal_id = upper(trim(p_bornaal_id));
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_bornaal_id(p_prefix text)
 RETURNS TABLE(user_id uuid, bornaal_id text, full_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT p.user_id, p.bornaal_id, p.name AS full_name
  FROM public.profiles p
  WHERE p.bornaal_id ILIKE p_prefix || '%'
  LIMIT 10;
END;
$function$;

-- 3. Unica funcao sem search_path fixo (aviso do linter de seguranca).
ALTER FUNCTION public.sync_notification_columns() SET search_path TO 'public';

-- 4. Chaves estrangeiras sem indice. Indolores hoje, dolorosas quando
--    order_status_history e notifications crescerem.
CREATE INDEX IF NOT EXISTS idx_appointment_status_history_appointment_id ON public.appointment_status_history (appointment_id);
CREATE INDEX IF NOT EXISTS idx_beauty_items_business_id                  ON public.beauty_items (business_id);
CREATE INDEX IF NOT EXISTS idx_commission_payments_business_id           ON public.commission_payments (business_id);
CREATE INDEX IF NOT EXISTS idx_commission_payments_validated_by          ON public.commission_payments (validated_by);
CREATE INDEX IF NOT EXISTS idx_complaints_client_id                      ON public.complaints (client_id);
CREATE INDEX IF NOT EXISTS idx_complaints_provider_id                    ON public.complaints (provider_id);
CREATE INDEX IF NOT EXISTS idx_delivery_proofs_delivery_id               ON public.delivery_proofs (delivery_id);
CREATE INDEX IF NOT EXISTS idx_delivery_proofs_driver_id                 ON public.delivery_proofs (driver_id);
CREATE INDEX IF NOT EXISTS idx_delivery_proofs_order_id                  ON public.delivery_proofs (order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_tracking_delivery_id             ON public.delivery_tracking (delivery_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_business_id                    ON public.menu_items (business_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_category_id                    ON public.menu_items (category_id);
CREATE INDEX IF NOT EXISTS idx_notifications_request_id                  ON public.notifications (request_id);
CREATE INDEX IF NOT EXISTS idx_order_status_history_order_id             ON public.order_status_history (order_id);
CREATE INDEX IF NOT EXISTS idx_platform_settings_updated_by              ON public.platform_settings (updated_by);
CREATE INDEX IF NOT EXISTS idx_portfolio_images_provider_id              ON public.portfolio_images (provider_id);
CREATE INDEX IF NOT EXISTS idx_service_requests_user_id                  ON public.service_requests (user_id);
