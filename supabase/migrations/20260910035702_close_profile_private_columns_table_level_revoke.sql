-- CORRECCAO de 20260910035532: o REVOKE por coluna nao teve efeito nenhum.
--
-- `REVOKE SELECT (col) ON tabela FROM papel` so' remove concessoes feitas
-- COLUNA A COLUNA. Se o papel tem SELECT concedido a' TABELA INTEIRA, o revoke
-- por coluna nao lhe toca -- e o privilegio de tabela cobre todas as colunas.
--
-- Medido: `authenticated` tinha SELECT ao nivel da tabela em `profiles`, logo
-- as 5 colunas continuavam legiveis depois do revoke anterior. O `anon` nao
-- tinha, porque 20260909160059 fez exactamente o que falta aqui: revogar a
-- tabela primeiro, conceder as colunas depois.
--
-- E' o terceiro membro da mesma familia de armadilhas nesta base de dados:
--   20260909213622 -- revogar de `anon` quando o privilegio vinha de PUBLIC
--   20260910033308 -- revogar de PUBLIC quando o privilegio era explicito a anon
--   esta           -- revogar por coluna quando o privilegio era de tabela
-- Em todos, o comando corre sem erro e nao faz nada. So' a medicao apanha.

REVOKE SELECT ON public.profiles FROM authenticated;

-- As 22 colunas nao-privadas. Espelha PUBLIC_PROFILE_COLUMNS em
-- src/lib/profileColumns.ts e o GRANT de 20260909160059 para o `anon`:
-- as tres listas tem de andar juntas. Fora ficam merchant_code,
-- payment_number e as tres de verificacao, que agora saem por RPC.
GRANT SELECT (
  id, user_id, name, category, description, location, photo_url, phone,
  lat, lng, profile_type, is_verified, verification_status,
  verification_submitted_at, consumption_options, prep_time_minutes,
  price_type, services, starting_price, bornaal_id, created_at, updated_at
) ON public.profiles TO authenticated;
