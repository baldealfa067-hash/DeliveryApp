-- ============================================================
-- Correção notificação de denúncia + contacto do denunciante
-- 1. FIX: notify_provider_on_complaint_status usava NEW.provider_id
--    (profiles.id) como notifications.user_id (auth.users.id) →
--    violação de FK ao validar/rejeitar. Agora resolve profiles.user_id.
-- 2. Nova coluna complaints.contact (telemóvel/WhatsApp do denunciante)
--    para o admin confirmar a denúncia antes de validar.
-- Versão IDEMPOTENTE — pode correr várias vezes (SQL Editor / CLI)
-- ============================================================

-- 1. Contacto do denunciante (opcional, só o admin vê)
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS contact text;

-- 2. Trigger corrigido — resolve o auth.users.id via profiles.user_id
CREATE OR REPLACE FUNCTION public.notify_provider_on_complaint_status()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  IF NEW.status IN ('validada', 'rejeitada') THEN
    SELECT p.user_id INTO v_user_id
    FROM public.profiles p
    WHERE p.id = NEW.provider_id;

    IF v_user_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (
        v_user_id,
        'denuncia_' || NEW.status,
        CASE WHEN NEW.status = 'validada'
          THEN 'Denúncia confirmada'
          ELSE 'Denúncia arquivada'
        END,
        CASE WHEN NEW.status = 'validada'
          THEN 'Recebemos uma denúncia contra si e, após análise, foi confirmada pela nossa equipa.'
          ELSE 'A denúncia contra si foi analisada e não foi confirmada. Obrigado.'
        END,
        '/perfil'
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;