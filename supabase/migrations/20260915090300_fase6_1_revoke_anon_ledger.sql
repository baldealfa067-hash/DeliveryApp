-- FASE 6.1 -- `anon` perde o SELECT de tabela em `ledger_entries` (§46, §49).
--
-- A migracao que criou a tabela concedeu SELECT ao `authenticated` e revogou
-- INSERT/UPDATE/DELETE de `anon` e `authenticated` -- mas nao revogou o SELECT
-- de `anon`. O Supabase concede-o por omissao a tudo o que nasce em `public`,
-- portanto ficou la'.
--
-- O efeito pratico era nulo: a policy e' `TO authenticated`, e um GET anonimo
-- devolvia `200 []`. Mas `200 []` e' o mesmo que a tabela devolve quando
-- simplesmente nao ha' linhas -- e hoje nao ha' nenhuma. No dia em que houver,
-- a unica coisa entre os movimentos financeiros de toda a gente e um pedido sem
-- autenticacao nenhuma e' a policy estar correcta. Isso e' uma linha de defesa,
-- nao duas.
--
-- Com o REVOKE, um pedido anonimo passa a levar 401 no portao das permissoes,
-- antes sequer de a policy ser avaliada. E' o mesmo padrao da Fase 1 em
-- `profiles`, `drivers` e `messages` (20260909160059).
--
-- NOTA sobre a razao de isto ser um REVOKE explicito e nao confianca no
-- default: nesta base ja' houve tres REVOKE que correram sem erro e sem efeito
-- (20260909213622, 20260910033308, 20260910035702). Por isso esta migracao e'
-- verificada por HTTP com a chave anon, e nao dada por feita.

REVOKE SELECT ON public.ledger_entries FROM anon;

-- `authenticated` mantem o SELECT: e' a policy "Ledger visivel ao dono da
-- conta" que decide quais linhas, e §84 exige que o parceiro consiga ver as
-- transaccoes que geraram a divida dele.
GRANT SELECT ON public.ledger_entries TO authenticated;
