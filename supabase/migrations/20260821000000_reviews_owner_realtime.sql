-- ============================================================
-- Reviews em tempo real para o dono do perfil
-- PROBLEMA: reviews entram com status='pendente' e a policy SELECT
-- pública só mostra 'aprovado'. O Realtime entrega eventos apenas se
-- a RLS SELECT do subscritor passar na linha alterada — por isso o
-- dono NUNCA recebia o INSERT de uma review nova e a contagem de
-- comentários só mudava ao recarregar a página.
-- SOLUÇÃO: policy SELECT própria do dono (prestador/loja), que passa
-- em qualquer status. O público continua a ver só as aprovadas.
-- Versão IDEMPOTENTE — pode correr várias vezes (SQL Editor / CLI)
-- ============================================================

DROP POLICY IF EXISTS "Providers can view own reviews" ON public.reviews;
CREATE POLICY "Providers can view own reviews" ON public.reviews
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = reviews.provider_id
        AND p.user_id = auth.uid()
    )
  );