-- CORRECCAO da Fase 2.2: o nome do restaurante vem de `profiles`, nao de
-- `businesses`.
--
-- COMO ISTO ENTROU: ao reescrever `notify_order_status_change` copiei o corpo
-- da migracao de origem (20260829060001), que faz
--     SELECT name INTO v_business_name FROM public.businesses ...
-- `public.businesses` NAO EXISTE neste projecto -- e' heranca do Bornaal (§45).
-- A versao que estava mesmo na base de dados ja nao a usava; o ficheiro de
-- migracao e a base tinham divergido, e eu confiei no ficheiro.
--
-- EFEITO: `update_order_status` passou a devolver
--     42P01 relation "public.businesses" does not exist
-- ou seja, HTTP 404, e NENHUM pedido mudava de estado. Apanhado pelo teste HTTP
-- (`scripts/alertas-test.mjs`, seccao 5) minutos depois de aplicar.
--
-- A LICAO, que e a mesma da REGRA DE ENGENHARIA: o ficheiro de migracao nao e'
-- a verdade, a base e' que e'. Antes de um CREATE OR REPLACE, comparar com
-- `pg_get_functiondef` -- foi o que fiz para o `create_order` (e por isso esse
-- ficou bem) e nao fiz para este.
--
-- O corpo completo desta funcao volta a ser substituido na migracao seguinte,
-- que consolida as fontes de notificacao. Esta fica como registo da correccao.

CREATE OR REPLACE FUNCTION public.notify_order_status_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_customer_id   uuid;
  v_business_name text;
  v_status_label  text;
  v_corpo         text;
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  v_customer_id := NEW.customer_id;
  -- `profiles`, nao `businesses`: e' a mesma tabela que o notify_new_order usa
  -- para chegar ao dono (orders.business_id -> profiles.id).
  SELECT name INTO v_business_name FROM public.profiles WHERE id = NEW.business_id;

  v_status_label := CASE NEW.status
    WHEN 'novo'                 THEN 'Recebido'
    WHEN 'confirmado'           THEN 'Confirmado'
    WHEN 'em_preparacao'        THEN 'Em preparacao'
    WHEN 'na_cozinha'           THEN 'Na cozinha'
    WHEN 'pronto'               THEN 'Pronto'
    WHEN 'aguardando_motorista' THEN 'A procurar motorista'
    WHEN 'motorista_encontrado' THEN 'Motorista a caminho do restaurante'
    WHEN 'pedido_recolhido'     THEN 'Recolhido pelo motorista'
    WHEN 'saiu_para_entrega'    THEN 'Saiu para entrega'
    WHEN 'a_caminho'            THEN 'A caminho'
    WHEN 'entregue'             THEN 'Entregue'
    WHEN 'concluido'            THEN 'Concluido'
    WHEN 'cancelado'            THEN 'Cancelado'
    ELSE NEW.status
  END;

  v_corpo := CASE NEW.status
    WHEN 'aguardando_motorista' THEN 'O seu pedido esta pronto e estamos a procurar um motorista.'
    WHEN 'motorista_encontrado' THEN 'Um motorista aceitou a entrega e vai buscar o seu pedido.'
    WHEN 'pedido_recolhido'     THEN 'O motorista ja tem o seu pedido.'
    WHEN 'a_caminho'            THEN 'O seu pedido vai a caminho.'
    WHEN 'cancelado'            THEN 'O seu pedido foi cancelado.'
    ELSE COALESCE(v_business_name, 'O restaurante') || ' atualizou o estado do seu pedido.'
  END;

  IF v_customer_id IS NOT NULL THEN
    PERFORM public.create_notification(
      v_customer_id,
      'Pedido #' || NEW.order_number || ' - ' || v_status_label,
      v_corpo,
      'order', 'order', NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

-- `notifications` fechada ao anonimo, pelo mesmo criterio da Fase 1 para
-- `profiles` e `messages`: o RLS ja segurava (o anonimo lia lista vazia, medido
-- por HTTP), mas nao ha uso anonimo legitimo nenhum desta tabela -- `user_id` e'
-- NOT NULL contra auth.users e todas as policies sao `TO authenticated`.
-- Tira-se a superficie em vez de a deixar a depender so da policy.
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.notifications FROM anon;
