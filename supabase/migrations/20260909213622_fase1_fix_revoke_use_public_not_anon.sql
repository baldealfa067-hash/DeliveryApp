-- FASE 1 (correccao) -- o REVOKE de 20260909160216 nao teve efeito nenhum.
--
-- DIAGNOSTICO: `REVOKE EXECUTE ... FROM anon` remove uma concessao EXPLICITA ao
-- papel `anon`. Mas o `anon` nunca teve concessao explicita: herdava o EXECUTE
-- atraves de PUBLIC, que o Postgres da' por omissao a toda a funcao criada.
-- O ACL mostrava `=X/postgres` (a entrada vazia a' esquerda do `=` e' PUBLIC) e
-- continuou a mostra-lo depois do REVOKE. Medido em producao antes desta
-- migracao: 23 de 23 com has_function_privilege('anon', ..., 'EXECUTE') = true.
--
-- CORRECCAO: revogar de PUBLIC. `authenticated` e `service_role` tem concessoes
-- explicitas proprias no ACL e nao sao afectados -- so' cai a heranca anonima.
-- Confirmado depois de aplicar: anon 0/23, authenticated 23/23.
--
-- AMBITO: exactamente as mesmas 23 funcoes aprovadas em 20260909160216, nem uma
-- a mais. As tres excepcoes deliberadas mantem-se com acesso anonimo (has_role,
-- increment_provider_view, record_provider_contact) e as funcoes de trigger
-- continuam de fora, pela razao dada nessa migracao.

REVOKE EXECUTE ON FUNCTION public.accept_delivery(p_delivery_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_delivery(p_delivery_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_delivery(p_order_id uuid, p_restaurant_lat double precision, p_restaurant_lng double precision, p_restaurant_address text, p_customer_lat double precision, p_customer_lng double precision, p_customer_address text, p_distance_km double precision) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_delivery_proof(p_delivery_id uuid, p_photo_url text, p_qr_validated boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_all_commissions() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_available_deliveries() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_bornaal_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_deliveries() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_notifications(p_limit integer, p_offset integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_unread_notifications_count() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_notifications_read(p_ids uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_request_completed(p_request_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pickup_delivery(p_delivery_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.register_as_driver(p_name text, p_phone text, p_vehicle_type text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.send_bulk_notification(p_title text, p_body text, p_target_groups text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.toggle_driver_availability() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_delivery_tracking(p_delivery_id uuid, p_lat double precision, p_lng double precision, p_status text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_driver_location(p_lat double precision, p_lng double precision) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_platform_setting(p_key text, p_value text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.upsert_push_subscription(p_endpoint text, p_keys jsonb, p_push_enabled boolean, p_novidades boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.validate_commission_payment(p_id uuid, p_status text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.validate_delivery_code(p_delivery_id uuid, p_code text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.validate_delivery_qr(p_delivery_id uuid, p_order_id uuid) FROM PUBLIC;
