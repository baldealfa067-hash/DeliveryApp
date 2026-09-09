-- FASE 1 -- fechar a visitantes anonimos o que nunca lhes devia ter estado
-- aberto (§46, §47). Ambito aprovado: `profiles` (excepto `phone`) e
-- `messages` para anonimos, mais o RLS de `drivers`.

-- ===========================================================================
-- 1. profiles -- anonimo lia TODAS as colunas
-- ===========================================================================
-- A policy "Profiles are viewable by everyone" e' USING (true) para o papel
-- publico, e o GRANT de SELECT cobria coluna a coluna. Um visitante sem sessao
-- despejava merchant_code, payment_number e os caminhos dos documentos de KYC
-- de todos os estabelecimentos.
--
-- A policy de leitura publica MANTEM-SE: navegar e ver restaurantes sem conta
-- e' o produto (§9). O que muda e' QUE colunas o anonimo recebe.
--
-- `phone` fica publico por decisao do dono do projecto (2026-09-09): e'
-- informacao de contacto normal, como ja' era no Bornaal.
-- `lat`/`lng` ficam publicos: sao a morada do estabelecimento, informacao de
-- negocio, nao localizacao de pessoa.
--
-- NOTA PARA QUEM MEXER NISTO: `select("*")` deixa de funcionar sem sessao,
-- porque o `*` expande para colunas revogadas e o pedido inteiro falha. O
-- frontend passa a pedir a lista explicita em src/lib/profileColumns.ts, que
-- tem de ser mantida em sincronia com este GRANT.
REVOKE SELECT ON public.profiles FROM anon;

GRANT SELECT (
  id, user_id, name, category, description, location, photo_url,
  phone, lat, lng,
  profile_type, is_verified, verification_status, verification_submitted_at,
  consumption_options, prep_time_minutes, price_type, services, starting_price,
  bornaal_id, created_at, updated_at
) ON public.profiles TO anon;

-- Ficam fora do alcance do anonimo:
--   merchant_code, payment_number          -- identificadores de pagamento
--   verification_doc_url,
--   verification_selfie_url,
--   verification_reason                    -- KYC
-- O `authenticated` continua a ve-las: o cliente precisa do codigo de
-- comerciante para pagar (§23) e o admin precisa do KYC para validar. Apertar
-- tambem o `authenticated` exige mover estas colunas para RPC com verificacao
-- de dono -- fica assinalado para uma fase posterior, fora do ambito aprovado.

-- ===========================================================================
-- 2. drivers -- anonimo lia telefone e localizacao em tempo real
-- ===========================================================================
-- "Drivers viewable by all" era USING (true) para o papel publico. Qualquer
-- pessoa sem sessao seguia a localizacao de qualquer motorista.
--
-- Ninguem no frontend le esta tabela para ver OUTRO motorista: as duas
-- leituras directas (useDrivers.ts:85 e getPostLoginDestination.ts:16) sao
-- ambas .eq("user_id", userId), a propria linha. Tudo o resto passa por RPCs
-- SECURITY DEFINER (get_available_deliveries, get_my_deliveries), que ignoram
-- o RLS e continuam a funcionar.
DROP POLICY IF EXISTS "Drivers viewable by all" ON public.drivers;

CREATE POLICY "Drivers viewable by self or admin"
ON public.drivers
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::app_role)
);

REVOKE SELECT ON public.drivers FROM anon;

-- ===========================================================================
-- 3. messages -- anonimo escrevia para qualquer pessoa e lia o que era anonimo
-- ===========================================================================
-- O WITH CHECK antigo era
--   (auth.uid() = sender_id) OR (sender_id IS NULL) OR (auth.uid() IS NULL)
-- ou seja, bastava nao ter sessao para inserir uma mensagem com qualquer
-- receiver_id. E "Users can view own messages" tinha OR (sender_id IS NULL),
-- portanto qualquer pessoa lia todas as mensagens anonimas.
--
-- Nao ha uma unica linha com sender_id NULL em producao (0 de 6), por isso
-- apertar isto nao esconde nem perde nada.
DROP POLICY IF EXISTS "Anyone can send messages" ON public.messages;

CREATE POLICY "Users send messages as themselves"
ON public.messages
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = sender_id);

DROP POLICY IF EXISTS "Users can view own messages" ON public.messages;
-- "messages_participants_only" ja' existe e diz exactamente o que e' preciso:
--   (sender_id = auth.uid()) OR (receiver_id = auth.uid())

REVOKE SELECT, INSERT, UPDATE, DELETE ON public.messages FROM anon;
