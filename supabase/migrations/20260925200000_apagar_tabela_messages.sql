-- Apaga a tabela `messages` (2026-09-25, decisão explícita do dono).
--
-- O chat cliente <-> restaurante foi removido na migração remover_chat_links e no
-- commit bf9f1a4: não há código nenhum que leia ou escreva esta tabela (frontend,
-- funções, triggers, vistas, edge functions — verificado). Tinha 6 mensagens, de
-- uma só conversa de 2026-09-06, entre um cliente e um restaurante.
--
-- Não é o caso de `reviews` e `portfolio_images`, que ficam: essas ainda servem a
-- vertical de beleza. Esta não servia mais nada.
--
-- O DROP leva consigo as 3 policies da tabela e a sua entrada na publicação
-- `supabase_realtime`. Não há chaves estrangeiras a apontar-lhe.
--
-- A mensagem de voz dessa conversa (portfolio/<uid>/chat/voice/...) sai do bucket
-- público a seguir, pelo scripts/mover-para-privado.mjs — que só a move depois
-- de esta tabela deixar de existir.

DO $$
DECLARE n int;
BEGIN
  -- Mais do que as 6 conhecidas quer dizer que alguma coisa ainda escreve aqui.
  SELECT count(*) INTO n FROM public.messages;
  IF n <> 6 THEN
    RAISE EXCEPTION 'messages tem % linhas, esperava 6: alguem ainda escreve na tabela -- abortado', n;
  END IF;

  SELECT count(*) INTO n FROM pg_constraint WHERE contype = 'f' AND confrelid = 'public.messages'::regclass;
  IF n > 0 THEN RAISE EXCEPTION 'ha % chaves estrangeiras a apontar para messages -- abortado', n; END IF;
END $$;

DROP TABLE public.messages;

DO $$
BEGIN
  IF to_regclass('public.messages') IS NOT NULL THEN
    RAISE EXCEPTION 'messages ainda existe';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = 'messages') THEN
    RAISE EXCEPTION 'messages ainda esta na publicacao supabase_realtime';
  END IF;
END $$;
