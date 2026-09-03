-- ============================================================
-- FIX: REPLICA IDENTITY FULL para messages
-- PROBLEMA: Sem REPLICA IDENTITY FULL, eventos UPDATE do
--           Supabase Realtime entregam payload incompleto
--           (apenas a primary key "id"). O callback no
--           useMessagesRealtime filtra por sender_id/receiver_id
--           que não existem no payload → invalidateQueries nunca
--           é chamado para UPDATEs (ex: marcar como lido).
-- SOLUÇÃO: ALTER TABLE messages REPLICA IDENTITY FULL
--          + garantir que a tabela está em supabase_realtime.
-- ============================================================

-- 1. Set REPLICA IDENTITY FULL so UPDATE events include all columns
ALTER TABLE public.messages REPLICA IDENTITY FULL;

-- 2. Ensure messages is in the realtime publication (idempotent)
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
