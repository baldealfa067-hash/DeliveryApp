-- Corrige um bypass de autorizacao causado por comparacao com NULL.
--
-- Seis funcoes SECURITY DEFINER protegiam-se com:
--     IF v_owner IS NULL OR v_owner <> auth.uid() THEN RAISE EXCEPTION 'Acesso negado';
--
-- Para um chamador anonimo auth.uid() e NULL, portanto `v_owner <> NULL` avalia a
-- NULL (nao TRUE) e o IF nunca dispara: a guarda era ignorada exactamente para quem
-- devia bloquear. Confirmado em producao — get_business_sales_stats devolvia a
-- facturacao real ao papel anon.
--
-- Correcao: `<>` passa a `IS DISTINCT FROM`, que devolve TRUE quando um dos lados e
-- NULL. Para utilizadores autenticados o comportamento e identico.
--
-- A substituicao e feita sobre a definicao actual de cada funcao para nao reescrever
-- corpos inteiros (e nao arriscar divergencias). Falha em voz alta se o padrao
-- esperado nao estiver presente.

DO $migration$
DECLARE
  v_alvo text;
  v_alvos text[] := ARRAY[
    'get_business_sales_stats',
    'get_business_daily_sales',
    'get_business_commission',
    'get_driver_delivery_stats',
    'get_driver_daily_stats',
    'validate_order_payment'
  ];
  v_oid oid;
  v_def text;
  v_novo text;
  v_ocorrencias integer;
BEGIN
  FOREACH v_alvo IN ARRAY v_alvos LOOP
    SELECT p.oid INTO v_oid
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_alvo;

    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Funcao public.% nao encontrada', v_alvo;
    END IF;

    v_def := pg_get_functiondef(v_oid);

    SELECT count(*) INTO v_ocorrencias
    FROM regexp_matches(v_def, '<>\s*auth\.uid\(\)', 'g');

    IF v_ocorrencias <> 1 THEN
      RAISE EXCEPTION 'public.%: esperava 1 ocorrencia de "<> auth.uid()", encontrei %',
        v_alvo, v_ocorrencias;
    END IF;

    v_novo := regexp_replace(v_def, '<>\s*auth\.uid\(\)', 'IS DISTINCT FROM auth.uid()');
    EXECUTE v_novo;

    RAISE NOTICE 'public.% corrigida', v_alvo;
  END LOOP;
END
$migration$;

-- Nenhuma destas funcoes tem motivo para ser chamada sem sessao iniciada.
REVOKE EXECUTE ON FUNCTION public.get_business_sales_stats(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_business_sales_stats(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_business_daily_sales(uuid, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_business_daily_sales(uuid, integer) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_business_commission(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_business_commission(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_driver_delivery_stats(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_driver_delivery_stats(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_driver_daily_stats(uuid, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_driver_daily_stats(uuid, integer) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.validate_order_payment(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.validate_order_payment(uuid, text) TO authenticated, service_role;
