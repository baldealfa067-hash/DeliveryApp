-- FASE 2.2 -- a TERCEIRA fonte de notificacao da mesma mudanca de estado.
--
-- Depois de largar o trigger duplicado, o cliente ainda recebia DUAS
-- notificacoes por cada mudanca de estado, medido por HTTP:
--
--   "Pedido #1 - Confirmado"   <- trigger trg_notify_order_status
--   "Atualizacao do pedido"    <- INSERT directo dentro de update_order_status
--
-- Mesmo acontecimento, dois avisos, dois pushes. §73.
--
-- QUAL FICA: o TRIGGER. §71 poe a fonte de verdade na tabela, nao na funcao que
-- calhou escreve-la -- e ha' mais do que um caminho a mudar `orders.status`
-- (complete_delivery e as sincronizacoes de entrega mexem no estado sem passar
-- pelo update_order_status). Um trigger apanha-os todos; o INSERT dentro da RPC
-- so apanha um.
--
-- MAS o texto que se perde era o melhor dos dois ("O restaurante confirmou o seu
-- pedido.", "Bom apetite!"), portanto migra para o trigger em vez de se deitar
-- fora. O trigger fica com o melhor dos dois lados: o titulo com numero de
-- pedido e estado, e o corpo que explica.
--
-- Migra tambem a guarda `IS DISTINCT FROM auth.uid()`: quem faz a mudanca nao
-- precisa de ser avisado dela. E' o caso do cliente que cancela o proprio
-- pedido e recebia um aviso a dizer-lhe o que acabara de fazer.

CREATE OR REPLACE FUNCTION public.notify_order_status_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_status_label text;
  v_corpo        text;
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;
  -- Quem mexeu no estado nao precisa de aviso do que acabou de fazer.
  -- auth.uid() e' NULL quando quem escreve e' um trabalho de fundo (pg_cron),
  -- e ai o aviso deve sair -- por isso IS DISTINCT FROM e nao <>.
  IF NEW.customer_id IS NOT DISTINCT FROM auth.uid() THEN RETURN NEW; END IF;

  v_status_label := CASE NEW.status
    WHEN 'novo'                 THEN 'Recebido'
    WHEN 'confirmado'           THEN 'Confirmado'
    WHEN 'em_preparacao'        THEN 'Em preparacao'
    WHEN 'na_cozinha'           THEN 'Na cozinha'
    WHEN 'pronto'               THEN 'Pronto'
    WHEN 'aguardando_motorista' THEN 'A procurar motorista'
    WHEN 'motorista_encontrado' THEN 'Motorista encontrado'
    WHEN 'pedido_recolhido'     THEN 'Recolhido'
    WHEN 'saiu_para_entrega'    THEN 'Saiu para entrega'
    WHEN 'a_caminho'            THEN 'A caminho'
    WHEN 'entregue'             THEN 'Entregue'
    WHEN 'concluido'            THEN 'Concluido'
    WHEN 'cancelado'            THEN 'Cancelado'
    ELSE NEW.status
  END;

  -- Texto herdado do update_order_status, que era o melhor dos dois (§52).
  v_corpo := CASE NEW.status
    WHEN 'confirmado'           THEN 'O restaurante confirmou o seu pedido.'
    WHEN 'em_preparacao'        THEN 'O restaurante comecou a preparar o seu pedido.'
    WHEN 'na_cozinha'           THEN 'O seu pedido esta a ser preparado.'
    WHEN 'pronto'               THEN 'O seu pedido esta pronto.'
    WHEN 'saiu_para_entrega'    THEN 'O seu pedido saiu para entrega. Aguarde em casa!'
    WHEN 'aguardando_motorista' THEN 'O seu pedido esta pronto e a espera de um motorista.'
    WHEN 'motorista_encontrado' THEN 'Um motorista aceitou a entrega.'
    WHEN 'pedido_recolhido'     THEN 'O motorista recolheu o seu pedido.'
    WHEN 'a_caminho'            THEN 'O seu pedido esta a caminho.'
    WHEN 'entregue'             THEN 'Pedido entregue. Bom apetite!'
    WHEN 'concluido'            THEN 'Pedido concluido. Bom apetite!'
    WHEN 'cancelado'            THEN 'O pedido foi cancelado.'
    ELSE 'Pedido atualizado: ' || NEW.status
  END;

  PERFORM public.create_notification(
    NEW.customer_id,
    'Pedido #' || NEW.order_number || ' - ' || v_status_label,
    v_corpo,
    'order', 'order', NEW.id
  );
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Tirar o INSERT de dentro do `update_order_status`
-- ---------------------------------------------------------------------------
--
-- FEITO SOBRE A DEFINICAO VIVA (`pg_get_functiondef`), NAO SOBRE O FICHEIRO.
-- E' deliberado, e a razao esta fresca: nesta mesma fase reescrevi
-- `notify_order_status_change` a partir do ficheiro de 20260829, que referia
-- `public.businesses` -- uma tabela que nao existe neste projecto. A base de
-- dados tinha divergido do repositorio e o CREATE OR REPLACE partiu o
-- `update_order_status` inteiro ate' ser apanhado pelo teste HTTP.
--
-- `update_order_status` e' uma funcao grande, com a matriz de transicoes da
-- Fase 1 e a autorizacao por papel la' dentro. Reescreve-la a partir do
-- ficheiro arriscava exactamente a mesma avaria, num sitio muito pior. Em vez
-- disso recorta-se o bloco da definicao real e volta-se a instalar.
--
-- A regex e' tolerante ao acento porque as versoes antigas escreviam
-- "Atualização" e as recentes "Atualizacao", e eu nao posso ver qual esta' la'.
-- Se NAO encontrar nada, ABORTA -- nunca passa em silencio a fingir que fez.
DO $do$
DECLARE
  v_def  text;
  v_novo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'update_order_status';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'update_order_status nao encontrada';
  END IF;

  v_novo := regexp_replace(
    v_def,
    'IF\s+v_customer_id\s+IS\s+NOT\s+NULL\s+AND\s+v_customer_id\s+IS\s+DISTINCT\s+FROM\s+auth\.uid\(\)\s+THEN\s*'
    || 'INSERT\s+INTO\s+public\.notifications\s*\([^)]*\)\s*'
    || 'VALUES\s*\(\s*v_customer_id\s*,\s*''order_update''\s*,\s*''Atualiza[^'']*''\s*,\s*v_status_label\s*,\s*''/meus-pedidos''\s*\)\s*;\s*'
    || 'END\s+IF\s*;',
    '-- (FASE 2.2) A notificacao do cliente saiu daqui: era a segunda do mesmo'
    || chr(10) || '  -- acontecimento. O trigger trg_notify_order_status e a unica fonte,'
    || chr(10) || '  -- e herdou este texto. Ver a migracao fase2_2_alertas_uma_notificacao.',
    'i'
  );

  IF v_novo = v_def THEN
    RAISE EXCEPTION
      'Nao encontrei o bloco de notificacao em update_order_status -- a '
      'definicao viva nao e a esperada. Nada foi alterado; inspeccionar a mao.';
  END IF;

  EXECUTE v_novo;

  -- Cinto e suspensorios: confirmar que o que ficou instalado ja nao escreve
  -- para notifications, e que continua a ter a matriz de transicoes.
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'update_order_status';

  IF v_def ~* 'INSERT\s+INTO\s+public\.notifications' THEN
    RAISE EXCEPTION 'O INSERT em notifications sobreviveu -- a substituicao nao pegou';
  END IF;
  IF v_def !~ 'v_allowed' AND v_def !~ 'transic' AND v_def !~ 'Transicao' THEN
    RAISE EXCEPTION 'A funcao instalada perdeu a matriz de transicoes -- abortar';
  END IF;
END
$do$;
