-- ============================================================
-- FIX CRÍTICO — Fluxo completo de service_requests (25/08/2026)
--
-- Problemas no estado live:
-- 1. INSERT quebrado para TODOS: a whitelist de status da policy
--    ("aberto","concluido","cancelado","fechado") não incluía o default
--    'open' usado pela app -> 42501 em qualquer publicação.
-- 2. Aba "Available" sem acesso anónimo: faltava policy SELECT TO anon
--    (visitantes viam lista vazia).
-- 3. Isolamento "Mine": authenticated lia todas as linhas; agora lê só as
--    próprias (qualquer status) + abertas de todos (marketplace público).
-- 4. Auto-close às 5 candidaturas era feito client-side e falhava em
--    silêncio (não há UPDATE policy) -> movido para trigger.
-- 5. Trigger notificar prestadores verificados da categoria reafirmado.
--
-- Idempotente - pode correr várias vezes (SQL Editor / CLI).
-- ============================================================

-- ------------------------------------------------------------
-- 1) INSERT: validações + status alinhado à app ('open','closed',
--    'concluido','cancelado') + user_id só pode ser a própria conta
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Public can create requests" ON public.service_requests;
CREATE POLICY "Public can create requests"
  ON public.service_requests
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    category IS NOT NULL AND btrim(category) <> '' AND char_length(btrim(category)) <= 80
    AND location IS NOT NULL AND btrim(location) <> '' AND char_length(btrim(location)) <= 80
    AND description IS NOT NULL AND btrim(description) <> '' AND char_length(btrim(description)) <= 2000
    AND (budget_amount IS NULL OR budget_amount >= 0)
    AND (budget_type IS NULL OR budget_type IN ('fixo','negociavel','combinar'))
    AND (requester_name IS NULL OR char_length(btrim(requester_name)) <= 80)
    AND (requester_phone IS NULL OR char_length(btrim(requester_phone)) <= 25)
    AND (status IS NULL OR status IN ('open','closed','concluido','cancelado'))
    AND (deadline IS NULL OR char_length(deadline) <= 50)
    AND (
      (auth.uid() IS NULL AND user_id IS NULL)
      OR
      (auth.uid() IS NOT NULL AND (user_id IS NULL OR user_id = auth.uid()))
    )
  );

-- ------------------------------------------------------------
-- 2) SELECT: abertos visíveis a todos (Available);
--    autenticados vêem também as próprias linhas (Mine), nunca mais que isso
-- ------------------------------------------------------------
-- Remove primeiro QUALQUER policy SELECT/INSERT legada com outros nomes
-- (garante isolamento mesmo se houver policies antigas desconhecidas)
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'service_requests'
             AND cmd = 'SELECT'
             AND policyname NOT IN ('Anyone can view open requests','Users view own or open requests')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.service_requests', r.policyname);
  END LOOP;
  FOR r IN SELECT policyname FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'service_requests'
             AND cmd = 'INSERT'
             AND policyname <> 'Public can create requests'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.service_requests', r.policyname);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Authenticated users can view requests" ON public.service_requests;
DROP POLICY IF EXISTS "Anyone can view open requests" ON public.service_requests;
DROP POLICY IF EXISTS "Users view own or open requests" ON public.service_requests;

CREATE POLICY "Anyone can view open requests"
  ON public.service_requests
  FOR SELECT TO anon
  USING (status = 'open');

CREATE POLICY "Users view own or open requests"
  ON public.service_requests
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR status = 'open');

-- Nota: admin continua com "Admins manage service_requests" (FOR ALL).

GRANT SELECT, INSERT ON public.service_requests TO anon;
GRANT SELECT, INSERT ON public.service_requests TO authenticated;
GRANT ALL ON public.service_requests TO service_role;

-- ------------------------------------------------------------
-- 3) Notificar prestadores verificados da categoria ao publicar
--    (reafirma 20260823000000; SECURITY DEFINER contorna RLS das notificações)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_providers_on_request()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.notifications (user_id, type, title, body, link, request_id)
  SELECT p.user_id, 'novo_pedido',
    'Novo pedido em ' || NEW.category,
    'Um cliente precisa de ' || NEW.category || ' em ' || NEW.location ||
      CASE WHEN NEW.deadline IS NOT NULL AND NEW.deadline != ''
        THEN ' — Prazo: ' || NEW.deadline ELSE '' END,
    '/pedidos', NEW.id
  FROM public.profiles p
  WHERE p.category = NEW.category
    AND p.profile_type = 'provider'
    AND p.is_verified = true
    AND p.user_id IS NOT NULL
    AND p.user_id != COALESCE(NEW.user_id, '00000000-0000-0000-0000-000000000000'::uuid);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_service_request_created ON public.service_requests;
CREATE TRIGGER on_service_request_created
  AFTER INSERT ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_providers_on_request();

-- Anti-spam server-side (reafirma; complementa o check client-side)
CREATE OR REPLACE FUNCTION public.check_request_spam()
RETURNS TRIGGER AS $$
DECLARE
  cnt int;
  today_start timestamptz := date_trunc('day', now());
BEGIN
  IF NEW.user_id IS NULL THEN
    IF NEW.requester_phone IS NULL OR btrim(NEW.requester_phone) = '' THEN
      RAISE EXCEPTION 'Telefone é obrigatório para publicar sem conta';
    END IF;
    SELECT count(*) INTO cnt FROM public.service_requests
      WHERE requester_phone = NEW.requester_phone
        AND user_id IS NULL
        AND created_at >= today_start;
    IF cnt >= 3 THEN
      RAISE EXCEPTION 'Limite de 3 pedidos por dia atingido para este número.';
    END IF;
  ELSE
    SELECT count(*) INTO cnt FROM public.service_requests
      WHERE user_id = NEW.user_id
        AND created_at >= today_start;
    IF cnt >= 10 THEN
      RAISE EXCEPTION 'Limite de 10 pedidos por dia atingido.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_service_request_spam_check ON public.service_requests;
CREATE TRIGGER on_service_request_spam_check
  BEFORE INSERT ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION public.check_request_spam();

-- ------------------------------------------------------------
-- 4) Fechar pedido automaticamente às 5 candidaturas (server-side,
--    substitui o update client-side que o RLS bloqueava em silêncio)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_request_at_5_bids()
RETURNS TRIGGER AS $$
DECLARE bid_count int;
BEGIN
  SELECT count(*) INTO bid_count FROM public.request_bids WHERE request_id = NEW.request_id;
  IF bid_count >= 5 THEN
    UPDATE public.service_requests
    SET status = 'closed'
    WHERE id = NEW.request_id AND status = 'open';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_bid_created_close_request ON public.request_bids;
CREATE TRIGGER on_bid_created_close_request
  AFTER INSERT ON public.request_bids
  FOR EACH ROW EXECUTE FUNCTION public.close_request_at_5_bids();
