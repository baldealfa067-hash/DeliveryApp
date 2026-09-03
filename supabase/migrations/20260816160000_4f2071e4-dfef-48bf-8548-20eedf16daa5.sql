-- 1. Adicionar colunas de prazo e orçamento aos service_requests
ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS deadline text,
  ADD COLUMN IF NOT EXISTS budget_type text NOT NULL DEFAULT 'combinar'
    CHECK (budget_type IN ('fixo','negociavel','combinar')),
  ADD COLUMN IF NOT EXISTS budget_amount integer CHECK (budget_amount >= 0);

-- 2. Criar tabela de candidaturas
CREATE TABLE public.request_bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.service_requests(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  message text,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','aceite','recusado')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, provider_id)
);

GRANT SELECT ON public.request_bids TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.request_bids TO authenticated;
GRANT ALL ON public.request_bids TO service_role;

ALTER TABLE public.request_bids ENABLE ROW LEVEL SECURITY;

-- Qualquer autenticado pode ver candidaturas
CREATE POLICY "Authenticated can view bids" ON public.request_bids
  FOR SELECT TO authenticated USING (true);

-- Prestador candidata-se ao pedido
CREATE POLICY "Providers can insert own bids" ON public.request_bids
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = request_bids.provider_id AND p.user_id = auth.uid()
    )
  );

-- Dono do pedido pode aceitar/recusar
CREATE POLICY "Request owners can update bids" ON public.request_bids
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_requests sr
      WHERE sr.id = request_bids.request_id AND sr.user_id = auth.uid()
    )
  )
  WITH CHECK (true);

-- Dono do pedido pode eliminar candidatura
CREATE POLICY "Request owners can delete bids" ON public.request_bids
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_requests sr
      WHERE sr.id = request_bids.request_id AND sr.user_id = auth.uid()
    )
  );

-- Admin gerencia tudo
CREATE POLICY "Admins manage bids" ON public.request_bids
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_request_bids_request ON public.request_bids(request_id);
CREATE INDEX idx_request_bids_provider ON public.request_bids(provider_id);
