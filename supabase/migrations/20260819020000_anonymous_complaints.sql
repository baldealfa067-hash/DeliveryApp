-- ============================================================
-- Denúncias anónimas — clientes podem denunciar sem criar conta
-- - client_id passa a ser opcional (null = anónimo)
-- - Qualquer visitante (anon) ou autenticado pode inserir
-- - Força status='pendente' (não é possível forjar denúncia validada)
-- - client_id = próprio utilizador ou NULL (não dá para atribuir a outro)
-- Versão IDEMPOTENTE — pode correr várias vezes (SQL Editor / CLI)
-- ============================================================

-- 1. client_id passa a ser opcional (denúncia anónima)
ALTER TABLE public.complaints ALTER COLUMN client_id DROP NOT NULL;

-- 2. Política de inserção: anon + authenticated, só 'pendente' e
--    client_id próprio ou NULL (anónimo)
DROP POLICY IF EXISTS "Anyone can insert complaints" ON public.complaints;
DROP POLICY IF EXISTS "Clients can insert complaints" ON public.complaints;
CREATE POLICY "Anyone can insert complaints" ON public.complaints
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    status = 'pendente'
    AND (client_id IS NULL OR client_id = auth.uid())
  );

-- 3. Permissões explícitas para o papel anon (insert)
GRANT INSERT ON public.complaints TO anon;
GRANT INSERT ON public.complaints TO authenticated;