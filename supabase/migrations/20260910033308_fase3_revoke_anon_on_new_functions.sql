-- FASE 3 (correccao) -- o REVOKE FROM PUBLIC nao chega em funcoes NOVAS.
--
-- E' o espelho exacto do bug de 20260909213622, e cai-se nele pelo lado oposto:
--
--   pg_default_acl mostra que este projecto tem
--     ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS
--       TO anon, authenticated, service_role;
--
--   Logo, uma funcao CRIADA AGORA nasce com concessao EXPLICITA ao `anon`
--   (`anon=X/postgres` no ACL) e SEM entrada PUBLIC. Revogar de PUBLIC nao lhe
--   toca -- nao ha nada de PUBLIC para revogar.
--
--   Uma funcao ANTIGA, criada antes destes default privileges, tinha o inverso:
--   `=X/postgres` (PUBLIC) e nenhuma concessao explicita a `anon`. Ai' era
--   revogar de PUBLIC que resolvia, e revogar de `anon` que nao fazia nada.
--
-- Medido depois do push de 20260909220000/221000/222000: 9 de 9 funcoes novas
-- com has_function_privilege('anon', ..., 'EXECUTE') = true, todas por
-- concessao explicita, nenhuma via PUBLIC.
--
-- REGRA daqui em diante, para nao cair em nenhum dos dois lados: revogar dos
-- DOIS. Uma das clausulas sera' sempre inofensiva, e o resultado e' correcto
-- independentemente da idade da funcao.
--
-- Nao se reescrevem as migracoes ja' aplicadas: elas ficam como correram, e a
-- correccao vive aqui -- a mesma disciplina de 20260909213622 (§56).
--
-- GRAVIDADE: as oito RPCs da frota tem guarda interna (`auth.uid() IS NULL` ou
-- `Sem frota`), portanto um anonimo levava com uma excepcao, nao com dados --
-- isto e' defesa em profundidade, nao uma porta aberta. A excepcao real e'
-- get_delivery_price, que nao tem guarda nenhuma: um anonimo podia enumerar o
-- preco de entrega mais barato de cada bairro. E' informacao pouco sensivel --
-- aparece no checkout a qualquer cliente -- mas nao ha razao para a dar a quem
-- nao tem conta.

REVOKE EXECUTE ON FUNCTION public.create_fleet(text, text, text)                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.add_driver_to_fleet(text, text, text)         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_driver_active(uuid, boolean)              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.remove_driver_from_fleet(uuid)                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.upsert_zone_price(text, numeric)              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_fleet_drivers()                           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_fleet_metrics()                           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_delivery_price(text)                      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.validate_commission_payment(uuid, text, text) FROM PUBLIC, anon;
