-- 1. Tabela de notificações
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'novo_pedido',
  title text NOT NULL,
  body text NOT NULL,
  link text,
  read boolean NOT NULL DEFAULT false,
  request_id uuid REFERENCES public.service_requests(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.notifications TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Cada utilizador vê as suas notificações
CREATE POLICY "Users see own notifications" ON public.notifications
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- O trigger pode inserir para qualquer utilizador (via SECURITY DEFINER)
CREATE POLICY "System can insert notifications" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Utilizador pode marcar as suas como lidas
CREATE POLICY "Users can mark own as read" ON public.notifications
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Admin gerencia tudo
CREATE POLICY "Admins manage notifications" ON public.notifications
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Índices
CREATE INDEX idx_notifications_user ON public.notifications(user_id, read, created_at DESC);

-- 2. Trigger: ao criar pedido, notifica todos os prestadores da categoria
CREATE OR REPLACE FUNCTION public.notify_providers_on_request()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.notifications (user_id, type, title, body, link, request_id)
  SELECT
    p.user_id,
    'novo_pedido',
    'Novo pedido: ' || NEW.category,
    'Um cliente precisa de ' || NEW.category || ' em ' || NEW.location ||
      CASE WHEN NEW.deadline IS NOT NULL AND NEW.deadline != ''
        THEN ' — Prazo: ' || NEW.deadline
        ELSE ''
      END,
    '/pedidos',
    NEW.id
  FROM public.profiles p
  WHERE p.category = NEW.category
    AND p.user_id IS NOT NULL
    AND p.user_id != COALESCE(NEW.user_id, '00000000-0000-0000-0000-000000000000'::uuid);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_service_request_created
  AFTER INSERT ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_providers_on_request();
