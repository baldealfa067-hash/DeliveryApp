-- Chat cliente <-> restaurante removido (2026-09-25, opção A, aprovado pelo dono).
--
-- As rotas /conversas e /mensagem/:userId saíram do frontend; no lugar do chat
-- ficou o ecrã /contacto, com os dois números da equipa.
--
-- A tabela `messages` e as 6 mensagens reais NÃO são tocadas: ficam intactas
-- até haver decisão explícita do dono sobre elas.

-- 1. create_notification deixa de gerar links para /mensagem/ ------------------
-- Mesma assinatura: CREATE OR REPLACE mantém os GRANTs. O ramo ELSIF de 'chat'
-- era código morto (o IF anterior já apanhava o mesmo caso) e sai com o resto.
-- Um reference_type 'chat' que ainda chegue cai no ELSE ('/'), como qualquer
-- tipo desconhecido.
CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id uuid,
  p_title text,
  p_message text,
  p_type text DEFAULT 'info'::text,
  p_reference_type text DEFAULT NULL::text,
  p_reference_id uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_link text;
BEGIN
  -- Build link from reference_type + reference_id
  IF p_reference_type IS NOT NULL AND p_reference_id IS NOT NULL THEN
    v_link := CASE p_reference_type
      WHEN 'order' THEN '/pedido/' || p_reference_id::text
      WHEN 'appointment' THEN '/meus-agendamentos/' || p_reference_id::text
      ELSE '/'
    END;
  ELSE
    v_link := NULL;
  END IF;

  INSERT INTO public.notifications (user_id, title, body, message, type, link, reference_type, reference_id, read, is_read)
  VALUES (p_user_id, p_title, p_message, p_message, p_type, v_link, p_reference_type, p_reference_id, false, false)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

-- 2. As notificações antigas de chat passam a levar ao ecrã de Contacto -------
-- Escolhido em vez de as apagar: não há código a manter para um tipo que já não
-- existe, e quem tocar numa delas chega a um ecrã que funciona, não a um 404.
-- `reference_type` fica 'chat': é o registo do que a notificação foi.
DO $$
DECLARE n int;
BEGIN
  UPDATE public.notifications
     SET link = '/contacto'
   WHERE reference_type = 'chat' AND link LIKE '/mensagem/%';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'notificacoes de chat reapontadas para /contacto: %', n;
END $$;

-- 3. Asserções ------------------------------------------------------------------
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.notifications WHERE link LIKE '/mensagem/%';
  IF n > 0 THEN RAISE EXCEPTION 'ainda ha % notificacoes a apontar para /mensagem/', n; END IF;

  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.prokind = 'f' AND pg_get_functiondef(p.oid) LIKE '%/mensagem/%';
  IF n > 0 THEN RAISE EXCEPTION 'ainda ha % funcoes a gerar links /mensagem/', n; END IF;

  -- A tabela de mensagens fica intacta, por decisao do dono.
  SELECT count(*) INTO n FROM public.messages;
  IF n <> 6 THEN RAISE EXCEPTION 'messages devia ter as 6 mensagens reais, tem %', n; END IF;
END $$;
