-- ============================================================
-- FASE 1 - CRÍTICO (1/7) - RLS P1/P2/P7
-- - orders: restringe SELECT a dono ou admin (fix P7)
-- - service_requests: INSERT com validação (fix P1), mantém SELECT anon->auth já feito
-- Idempotente - pode correr várias vezes
-- ============================================================

-- 1. ORDERS: fix P7 - qualquer authenticated NÃO pode ver todas as encomendas
DROP POLICY IF EXISTS "Orders viewable by authenticated" ON public.orders;
DROP POLICY IF EXISTS "Orders viewable by owner or admin" ON public.orders;
CREATE POLICY "Orders viewable by owner or admin" ON public.orders
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = orders.business_id AND p.user_id = auth.uid())
  );

-- Mantém: "Orders admins manage" já existe (FOR ALL admin), não tocar
-- Garante que anon NÃO pode ler orders (não há policy anon)
REVOKE ALL ON public.orders FROM anon;
GRANT SELECT ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;

-- 2. SERVICE_REQUESTS: fix P1 - anon pode criar mas com validação de campos
-- Antes: WITH CHECK (true) permitia qualquer JSON (XSS, campos vazios, flood sem validação)
DROP POLICY IF EXISTS "Public can create requests" ON public.service_requests;
CREATE POLICY "Public can create requests" ON public.service_requests
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    -- campos obrigatórios não vazios e com limites (evita XSS gigante / dados inválidos)
    category IS NOT NULL AND btrim(category) <> '' AND char_length(btrim(category)) <= 80
    AND location IS NOT NULL AND btrim(location) <> '' AND char_length(btrim(location)) <= 80
    AND description IS NOT NULL AND btrim(description) <> '' AND char_length(btrim(description)) <= 2000
    AND (budget_amount IS NULL OR budget_amount >= 0)
    AND (budget_type IS NULL OR budget_type IN ('fixo','negociavel','combinar'))
    AND (requester_name IS NULL OR char_length(btrim(requester_name)) <= 80)
    AND (requester_phone IS NULL OR char_length(btrim(requester_phone)) <= 25)
    AND (status IS NULL OR status IN ('aberto','concluido','cancelado','fechado'))
    AND (deadline IS NULL OR char_length(deadline) <= 50)
  );

-- Garante que SELECT continua só para authenticated (P2 já corrigido em 20260608065349)
-- Recria para garantir estado correto (idempotente)
DROP POLICY IF EXISTS "Public can view requests" ON public.service_requests;
DROP POLICY IF EXISTS "Authenticated users can view requests" ON public.service_requests;
CREATE POLICY "Authenticated users can view requests"
  ON public.service_requests
  FOR SELECT TO authenticated
  USING (true);

-- Admin mantém gestão total
DROP POLICY IF EXISTS "Admins manage service_requests" ON public.service_requests;
CREATE POLICY "Admins manage service_requests" ON public.service_requests
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT SELECT, INSERT ON public.service_requests TO anon;
GRANT SELECT, INSERT ON public.service_requests TO authenticated;
GRANT ALL ON public.service_requests TO service_role;
