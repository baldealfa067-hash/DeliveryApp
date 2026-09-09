-- Corrige 3 falhas de RLS herdadas do Bornaal que nunca foram corrigidas nesta copia.
--
-- P3  request_bids : qualquer autenticado via TODAS as candidaturas de TODOS os pedidos
--                    (policy "Authenticated can view bids" USING (true), de 20260816160000)
-- P11 reviews      : policy permissiva "Public can create reviews" WITH CHECK (true)
--                    (de 20260605133126) nunca foi dropada. Policies permissivas combinam
--                    com OR, por isso a policy restrita de 20260822000000 nao a anulava --
--                    a protecao real estava so nos triggers.
-- P2  service_requests : requester_phone legivel por anon em qualquer pedido aberto.

-- ============================================================================
-- P3 - request_bids: so o candidato, o dono do pedido e o admin veem a candidatura
-- ============================================================================
DROP POLICY IF EXISTS "Authenticated can view bids" ON public.request_bids;

CREATE POLICY "Bids viewable by bidder, request owner or admin"
ON public.request_bids
FOR SELECT
TO authenticated
USING (
  -- o proprio candidato (o prestador que fez a proposta)
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = request_bids.provider_id
      AND p.user_id = auth.uid()
  )
  -- o dono do pedido original, para poder escolher entre propostas
  OR EXISTS (
    SELECT 1 FROM public.service_requests sr
    WHERE sr.id = request_bids.request_id
      AND sr.user_id = auth.uid()
  )
  OR public.has_role(auth.uid(), 'admin'::app_role)
);

-- Nota: close_request_at_5_bids(), notify_owner_on_bid(), mark_request_completed()
-- e validate_review_insert() leem request_bids mas sao todas SECURITY DEFINER,
-- por isso continuam a ver todas as linhas.

-- ============================================================================
-- P11 - reviews: remover a policy permissiva antiga
-- ============================================================================
-- Ficam ativas apenas:
--   "Anonymous can insert reviews"     anon          WITH CHECK (user_id IS NULL)
--   "Authenticated can insert reviews" authenticated WITH CHECK (auth.uid() = user_id)
--   "Admins manage reviews"            authenticated ALL
-- Os triggers validate_review_insert() e check_review_spam() mantem-se intactos
-- como camada adicional (defesa em profundidade), mas a policy ja nao depende deles.
DROP POLICY IF EXISTS "Public can create reviews" ON public.reviews;

-- ============================================================================
-- P2 - service_requests: requester_phone deixa de ser legivel por anon
-- ============================================================================
-- O GRANT era ao nivel da tabela, por isso REVOKE SELECT (coluna) nao teria efeito:
-- e preciso revogar o SELECT da tabela e re-conceder coluna a coluna.
REVOKE SELECT ON public.service_requests FROM anon, authenticated;

GRANT SELECT (
  id,
  user_id,
  category,
  description,
  location,
  status,
  created_at,
  requester_name,
  deadline,
  budget_type,
  budget_amount
) ON public.service_requests TO anon, authenticated;

-- O telefone passa a ser acessivel so por RPC, a quem tem legitimidade no fluxo:
-- o autor do pedido, um prestador que se candidatou a esse pedido, ou um admin.
CREATE OR REPLACE FUNCTION public.get_request_contact_phone(p_request_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sr.requester_phone
  FROM public.service_requests sr
  WHERE sr.id = p_request_id
    AND auth.uid() IS NOT NULL
    AND (
      sr.user_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.request_bids b
        JOIN public.profiles p ON p.id = b.provider_id
        WHERE b.request_id = sr.id
          AND p.user_id = auth.uid()
      )
      OR public.has_role(auth.uid(), 'admin'::app_role)
    );
$$;

REVOKE ALL ON FUNCTION public.get_request_contact_phone(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_request_contact_phone(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_request_contact_phone(uuid) TO authenticated;
