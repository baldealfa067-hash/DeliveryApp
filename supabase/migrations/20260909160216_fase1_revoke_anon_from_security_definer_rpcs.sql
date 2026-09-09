-- FASE 1 -- retirar ao papel `anon` o EXECUTE das RPCs SECURITY DEFINER que
-- nao lhe dizem respeito (§46, defesa em profundidade).
--
-- Todas estas tem guarda interna por auth.uid() ou has_role -- foi verificado
-- funcao a funcao na auditoria -- por isso isto nao corrige uma falha aberta:
-- fecha a porta a que uma guarda futura seja esquecida numa delas. Era o que a
-- migracao 20260907085642 se propunha fazer e deixou por terminar.
--
-- TRES FICAM DE PROPOSITO COM ACESSO ANONIMO:
--
--   has_role(uuid, app_role)
--     E' chamada DENTRO de expressoes de policy. Varias policies (por exemplo
--     em business_categories e beauty_categories) aplicam-se ao papel publico,
--     e o anonimo tem de a poder avaliar. Revoga-la partia leituras anonimas
--     legitimas com "permission denied for function has_role".
--
--   increment_provider_view(uuid)      -- BusinessDetail.tsx:110
--   record_provider_contact(uuid,text) -- BusinessDetail.tsx:194
--     Correm em /loja/:id, que e' rota publica: um visitante sem conta pode ver
--     um restaurante e tocar em "ligar" (§9). Ambas so' incrementam contadores.
--
-- As funcoes de trigger nao entram nesta lista: nao sao invocaveis
-- directamente e mexer-lhes nas permissoes arrisca partir triggers que correm
-- no contexto de escritas anonimas legitimas.
REVOKE EXECUTE ON FUNCTION public.accept_delivery(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.complete_delivery(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_delivery(uuid, double precision, double precision, text, double precision, double precision, text, double precision) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_delivery_proof(uuid, text, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_all_commissions() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_available_deliveries() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_bornaal_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_deliveries() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_notifications(integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_unread_notifications_count() FROM anon;
REVOKE EXECUTE ON FUNCTION public.mark_notifications_read(uuid[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.mark_request_completed(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.pickup_delivery(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.register_as_driver(text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.send_bulk_notification(text, text, text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.toggle_driver_availability() FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_delivery_tracking(uuid, double precision, double precision, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_driver_location(double precision, double precision) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_platform_setting(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.upsert_push_subscription(text, jsonb, boolean, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.validate_commission_payment(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.validate_delivery_code(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.validate_delivery_qr(uuid, uuid) FROM anon;
