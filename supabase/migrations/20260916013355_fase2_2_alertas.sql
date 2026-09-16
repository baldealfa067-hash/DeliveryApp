-- FASE 2.2 -- Alertas (§35, §52, §73, §83).
--
-- AVISO AO LEITOR: a versao de `notify_order_status_change` que esta' aqui em
-- baixo tem um defeito -- le' `public.businesses`, tabela que NAO existe neste
-- projecto (heranca do Bornaal, §45). Foi copiada do ficheiro de origem
-- 20260829060001 sem confirmar contra a base de dados, que ja' tinha divergido.
-- Partiu o `update_order_status` inteiro durante alguns minutos.
-- Corrigido em `20260916014049_fase2_2_alertas_fix_business_name`, e a funcao
-- volta a ser substituida em `20260916014226_..._uma_notificacao_por_mudanca_de_estado`.
-- Fica aqui como estava, porque o historico de migracoes e' um registo do que
-- aconteceu, nao uma versao limpa a posteriori (mesmo espirito do §56).
--
-- Tres alertas pedidos: stock baixo/esgotado, novos pedidos (confirmar), e
-- entregas presas. A auditoria mudou duas das tres respostas.
--
-- ===========================================================================
-- ACHADO 1 -- "novos pedidos ja existe, so confirmar": NAO estava correcto.
-- ===========================================================================
-- Estava a notificar A DOBRAR, e ja em producao. Medido, nao suposto:
--
--   SELECT ... FROM orders o JOIN notifications n ON n.reference_id = o.id
--   GROUP BY ... HAVING count(*) > 1
--
-- devolveu TODAS as notificacoes de todos os pedidos com quantas = 2.
-- "Novo Pedido #2" duas vezes ao dono, "Pedido #2 - Confirmado" duas vezes ao
-- cliente, e assim por diante. Duas causas independentes:
--
--   a) `orders` tinha DOIS triggers a chamar a MESMA funcao em cada mudanca de
--      estado -- `on_order_status_change` e `trg_notify_order_status`. Sao
--      nomes diferentes para o mesmo `notify_order_status_change()`, portanto o
--      Postgres corre-a duas vezes. Vem de a funcao ter sido recriada numa
--      migracao posterior com um nome de trigger novo, sem largar o antigo.
--
--   b) o dono era avisado do pedido novo por dois caminhos: o trigger
--      `trg_notify_new_order` (AFTER INSERT) e uma chamada directa a
--      `create_notification` no fim do `create_order`.
--
-- §73 manda prevenir "comissoes duplicadas ... pedidos duplicados"; uma
-- notificacao a dobrar e' a mesma familia de defeito, e cada uma delas dispara
-- tambem um push (`on_notification_created_push`), portanto o telemovel do dono
-- tocava duas vezes por pedido. Isto tinha de ser corrigido ANTES de acrescentar
-- alertas novos, senao os alertas novos herdavam o mesmo defeito.
--
-- QUAL DOS DOIS CAMINHOS FICA, no caso (b): fica o TRIGGER. Cobre o dono e o
-- cliente (a chamada directa so' cobria o dono) e nao depende do caminho de
-- escrita -- qualquer INSERT em `orders`, venha do `create_order` ou nao, avisa
-- quem tem de avisar. §71: a fonte de verdade e' a tabela, nao a funcao que
-- calhou escreve-la.
--
-- ===========================================================================
-- ACHADO 2 -- "entregas presas expiram em silencio": ja NAO era verdade.
-- ===========================================================================
-- A Fase 5 (20260914092000) ja notifica o dono do restaurante e os admins
-- quando o dispatch ESGOTA as rondas. Isso esta feito e nao se reconstroi.
--
-- O silencio que restava e' outro, e e' o das rondas DO MEIO: a 1a ronda expira,
-- o sistema re-oferece a' mesma frota, e ninguem sabe. Com o timeout em 10
-- minutos e 2 rondas, o restaurante passa 20 minutos sem sinal nenhum antes do
-- primeiro aviso, com o cliente a olhar para "a espera de um motorista". E' esse
-- o buraco que esta migracao tapa.
--
-- O ADMIN continua a ser avisado SO' no esgotamento, de proposito: um aviso por
-- ronda por entrega, numa plataforma inteira, e' ruido que faz ignorar os avisos
-- que importam.
--
-- ===========================================================================
-- DECISAO -- limiar de stock baixo: 3 unidades.
-- ===========================================================================
-- Configuravel em `platform_settings.stock_low_threshold`, como ja acontece com
-- `dispatch_timeout_minutes`. Tres porque o alerta tem de chegar com tempo util
-- de reposicao e o restaurante em Bissau repoe a' mao: a 1 unidade o aviso
-- chega tarde de mais, a 10 toca todos os dias e deixa de ser lido.

-- ---------------------------------------------------------------------------
-- PARTE 1 -- fechar a duplicacao (§73)
-- ---------------------------------------------------------------------------

-- (a) O trigger a mais. Ficam os dois nomes documentados aqui para nao voltar a
-- ser recriado por engano: `trg_notify_order_status` e' o que fica.
DROP TRIGGER IF EXISTS on_order_status_change ON public.orders;

-- Rotulos de estado completos. Faltavam `aguardando_motorista`,
-- `motorista_encontrado` e `pedido_recolhido`, e o ELSE despejava o nome cru da
-- constante no ecra do cliente -- ha notificacoes em producao com o titulo
-- "Pedido #2 - aguardando_motorista". §52 diz para evitar jargao tecnico.
--
-- Os NOMES DAS CONSTANTES nao se tocam (Aditamento 2): isto e' so' o texto que
-- o cliente le'. `entregue` mantem-se no CASE como defesa -- foi fundido em
-- `concluido` em 2026-09-09 e nao deve aparecer, mas se aparecer e' melhor ler
-- "Entregue" do que rebentar o rotulo.
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
  SELECT name INTO v_business_name FROM public.businesses WHERE id = NEW.business_id;

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

  -- §52: o cliente quer saber o que aconteceu, nao que "o estado foi
  -- atualizado". Texto proprio nos estados em que ha alguma coisa a dizer.
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

-- (b) A chamada directa no fim do `create_order`. O corpo abaixo e' o da Fase
-- 2.1 com esse bloco -- e so' esse bloco -- removido.
CREATE OR REPLACE FUNCTION public.create_order(
  p_business_id uuid, p_customer_id uuid, p_customer_name text, p_customer_phone text,
  p_items jsonb, p_total numeric, p_consumption_option text,
  p_address text DEFAULT NULL, p_notes text DEFAULT NULL, p_bairro text DEFAULT NULL,
  p_customer_lat double precision DEFAULT NULL, p_customer_lng double precision DEFAULT NULL,
  p_voice_note_url text DEFAULT NULL, p_payment_method text DEFAULT 'entrega',
  p_payment_proof_url text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_order_id      uuid;
  v_order_number  integer;
  v_delivery_code text;
  v_owner_id      uuid;
  v_fleet_id      uuid;
  v_delivery_fee  numeric;
  v_item          jsonb;
  v_qty           integer;
  v_mi_id         uuid;
  v_mi_nome       text;
  v_mi_preco      numeric;
  v_mi_disp       boolean;
  v_quantos       integer;
  v_total_calc    numeric := 0;
  v_items_norm    jsonb   := '[]'::jsonb;
  v_novo_stock    integer;
BEGIN
  PERFORM public.assert_can_order_for(p_business_id, p_customer_id);

  IF p_customer_name IS NULL OR btrim(p_customer_name) = '' THEN
    RAISE EXCEPTION 'Nome do cliente obrigatorio';
  END IF;
  IF p_customer_phone IS NULL OR btrim(p_customer_phone) = '' THEN
    RAISE EXCEPTION 'Telefone do cliente obrigatorio';
  END IF;
  IF p_consumption_option NOT IN ('comer_no_local', 'para_levar', 'entrega') THEN
    RAISE EXCEPTION 'Opcao de consumo invalida';
  END IF;
  IF p_payment_method NOT IN ('entrega', 'online') THEN
    RAISE EXCEPTION 'Metodo de pagamento invalido';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Pedido sem artigos';
  END IF;

  -- Resolver contra o menu e somar dai (Fase 2.0).
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := COALESCE(
      NULLIF(v_item->>'qty', '')::integer,
      NULLIF(v_item->>'quantity', '')::integer,
      0
    );
    CONTINUE WHEN v_qty <= 0;

    v_mi_id := NULL;

    IF NULLIF(v_item->>'menu_item_id', '') IS NOT NULL THEN
      SELECT mi.id, mi.name, mi.price, mi.is_available
      INTO v_mi_id, v_mi_nome, v_mi_preco, v_mi_disp
      FROM public.menu_items mi
      WHERE mi.id = (v_item->>'menu_item_id')::uuid
        AND mi.business_id = p_business_id;

      IF v_mi_id IS NULL THEN
        RAISE EXCEPTION 'Artigo nao pertence a este restaurante';
      END IF;
    ELSE
      SELECT count(*) INTO v_quantos
      FROM public.menu_items mi
      WHERE mi.business_id = p_business_id
        AND lower(btrim(mi.name)) = lower(btrim(COALESCE(v_item->>'name', '')));

      IF v_quantos = 0 THEN
        RAISE EXCEPTION 'Artigo "%" nao existe no menu deste restaurante', COALESCE(v_item->>'name', '');
      END IF;
      IF v_quantos > 1 THEN
        RAISE EXCEPTION 'Artigo "%" aparece mais do que uma vez no menu; o pedido tem de indicar qual', COALESCE(v_item->>'name', '');
      END IF;

      SELECT mi.id, mi.name, mi.price, mi.is_available
      INTO v_mi_id, v_mi_nome, v_mi_preco, v_mi_disp
      FROM public.menu_items mi
      WHERE mi.business_id = p_business_id
        AND lower(btrim(mi.name)) = lower(btrim(COALESCE(v_item->>'name', '')));
    END IF;

    -- O interruptor do dono. O stock em si e' tratado no desconto la abaixo,
    -- que e' onde a decisao pode ser tomada em seguranca.
    IF NOT v_mi_disp THEN
      RAISE EXCEPTION 'O artigo "%" nao esta disponivel', v_mi_nome;
    END IF;

    v_total_calc := v_total_calc + (v_mi_preco * v_qty);

    v_items_norm := v_items_norm || jsonb_build_object(
      'menu_item_id', v_mi_id, 'name', v_mi_nome, 'price', v_mi_preco, 'qty', v_qty
    );
  END LOOP;

  IF jsonb_array_length(v_items_norm) = 0 THEN
    RAISE EXCEPTION 'Pedido sem artigos';
  END IF;

  IF p_total IS NOT NULL AND round(p_total, 2) <> round(v_total_calc, 2) THEN
    RAISE EXCEPTION 'O preco dos artigos mudou (ecra: %, menu: %). Volte a abrir o menu.',
      round(p_total, 2), round(v_total_calc, 2);
  END IF;

  IF p_consumption_option = 'entrega' AND p_bairro IS NOT NULL THEN
    SELECT gp.fleet_id, gp.preco INTO v_fleet_id, v_delivery_fee
    FROM public.get_delivery_price(p_bairro) gp;
  END IF;

  v_delivery_code := lpad((floor(random() * 1000000))::text, 6, '0');

  -- NUMERO DO PEDIDO, atomico. Era `SELECT MAX(order_number) + 1`, que com dois
  -- pedidos simultaneos dava o mesmo numero aos dois. O upsert bloqueia a linha
  -- do contador e serializa -- o segundo espera e le o valor ja incrementado.
  INSERT INTO public.business_order_counters (business_id, last_number)
  VALUES (p_business_id, 1)
  ON CONFLICT (business_id) DO UPDATE
    SET last_number = public.business_order_counters.last_number + 1
  RETURNING last_number INTO v_order_number;

  INSERT INTO public.orders (
    business_id, customer_id, customer_name, customer_phone,
    items, total, status, consumption_option,
    address, notes, order_number, delivery_code,
    bairro, customer_lat, customer_lng, voice_note_url,
    payment_method, payment_proof_url, payment_status,
    fleet_id, delivery_fee
  ) VALUES (
    p_business_id, p_customer_id, btrim(p_customer_name), btrim(p_customer_phone),
    v_items_norm, v_total_calc, 'novo', p_consumption_option,
    CASE WHEN p_consumption_option = 'entrega' THEN p_address ELSE NULL END,
    p_notes, v_order_number, v_delivery_code,
    CASE WHEN p_consumption_option = 'entrega' THEN p_bairro ELSE NULL END,
    CASE WHEN p_consumption_option = 'entrega' THEN p_customer_lat ELSE NULL END,
    CASE WHEN p_consumption_option = 'entrega' THEN p_customer_lng ELSE NULL END,
    CASE WHEN p_consumption_option = 'entrega' THEN p_voice_note_url ELSE NULL END,
    p_payment_method, p_payment_proof_url, 'pendente',
    v_fleet_id, v_delivery_fee
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (order_id, menu_item_id, name_snapshot, unit_price_snapshot, qty)
  SELECT v_order_id, (e->>'menu_item_id')::uuid, e->>'name',
         (e->>'price')::numeric, (e->>'qty')::integer
  FROM jsonb_array_elements(v_items_norm) e;

  -- DESCONTO DE STOCK. A decisao esta dentro do UPDATE, nunca num SELECT
  -- antes: e' a clausula WHERE que e' reavaliada depois do lock largar, e e'
  -- por isso que dois pedidos a ultima unidade nao ganham os dois.
  --
  -- Corre DEPOIS de o pedido existir, para o ajuste poder apontar para ele. Se
  -- faltar stock, o RAISE desfaz a transaccao inteira -- o pedido tambem.
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items_norm) LOOP
    v_mi_id := (v_item->>'menu_item_id')::uuid;
    v_qty   := (v_item->>'qty')::integer;

    UPDATE public.menu_items
       SET stock_qty = stock_qty - v_qty
     WHERE id = v_mi_id
       AND track_stock = true
       AND stock_qty >= v_qty
    RETURNING stock_qty INTO v_novo_stock;

    IF FOUND THEN
      INSERT INTO public.stock_adjustments (
        menu_item_id, order_id, delta, qty_antes, qty_depois, motivo, created_by)
      VALUES (v_mi_id, v_order_id, -v_qty, v_novo_stock + v_qty, v_novo_stock,
              'Venda', p_customer_id);
    ELSE
      -- Ou o artigo nao segue stock (caso normal), ou nao havia que chegasse.
      -- So o segundo e' erro, e distinguem-se relendo a linha.
      IF EXISTS (SELECT 1 FROM public.menu_items WHERE id = v_mi_id AND track_stock = true) THEN
        RAISE EXCEPTION 'Sem stock suficiente de "%"', v_item->>'name';
      END IF;
    END IF;
  END LOOP;

  INSERT INTO public.order_status_history (order_id, status, created_by)
  VALUES (v_order_id, 'novo', p_customer_id);

  BEGIN
    INSERT INTO public.provider_activity (provider_id, activity_type)
    VALUES (p_business_id, 'order');
  EXCEPTION WHEN others THEN NULL;
  END;

  -- (FASE 2.2) A notificacao do dono saiu daqui: era a SEGUNDA. O trigger
  -- trg_notify_new_order ja a envia, e ja avisa tambem o cliente.

  RETURN v_order_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.create_order(uuid, uuid, text, text, jsonb, numeric, text, text, text, text, double precision, double precision, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_order(uuid, uuid, text, text, jsonb, numeric, text, text, text, text, double precision, double precision, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- PARTE 2 -- alertas de stock baixo e esgotado
-- ---------------------------------------------------------------------------

INSERT INTO public.platform_settings (key, value)
VALUES ('stock_low_threshold', '3')
ON CONFLICT (key) DO NOTHING;

-- POR TRANSICAO, NAO POR ESTADO. A diferenca importa: "avisar quando
-- stock_qty <= 3" dispara em CADA venda abaixo de 3 -- tres unidades vendidas
-- uma a uma dao tres avisos iguais. O que se quer e' o momento em que o artigo
-- ATRAVESSA o limiar para baixo:
--
--   OLD.stock_qty > limiar  AND  NEW.stock_qty <= limiar
--
-- Repor stock volta a por o artigo acima do limiar, e o proximo atravessamento
-- volta a avisar. E' o mesmo principio do `is_orderable` da Fase 2.1: o estado
-- deriva-se, nao se acumula uma flag de "ja avisei" que depois e' preciso
-- limpar a mao.
--
-- ESGOTADO GANHA A BAIXO. Uma venda que leve 5 -> 0 satisfaz as duas condicoes;
-- manda-se so' a de esgotado, que e' a que diz o que e' preciso saber. IF/ELSIF,
-- nao dois IF.
--
-- NUNCA PODE PARTIR UM PEDIDO. Este trigger corre DENTRO da transaccao do
-- `create_order` (o desconto de stock e' um UPDATE a `menu_items`). Uma excepcao
-- aqui -- dono sem perfil, `platform_settings` com lixo, o push em baixo --
-- desfazia a venda inteira. §86 poe a integridade do pedido acima da
-- notificacao, portanto o corpo vai todo dentro de um bloco que engole o erro e
-- deixa passar. Um alerta perdido e' um aborrecimento; um pedido perdido e' uma
-- avaria.
CREATE OR REPLACE FUNCTION public.tg_alerta_stock()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_limiar integer;
  v_dono   uuid;
BEGIN
  -- Guardas baratas primeiro, fora do bloco de excepcao: nao segue stock, ou
  -- nao desceu, nao ha nada a fazer. `>=` apanha tambem a reposicao.
  IF NOT NEW.track_stock THEN RETURN NEW; END IF;
  IF NEW.stock_qty IS NULL OR OLD.stock_qty IS NULL THEN RETURN NEW; END IF;
  IF NEW.stock_qty >= OLD.stock_qty THEN RETURN NEW; END IF;

  BEGIN
    SELECT COALESCE(NULLIF(value, '')::integer, 3) INTO v_limiar
    FROM public.platform_settings WHERE key = 'stock_low_threshold';
    v_limiar := COALESCE(v_limiar, 3);

    SELECT p.user_id INTO v_dono
    FROM public.profiles p WHERE p.id = NEW.business_id;

    IF v_dono IS NULL THEN RETURN NEW; END IF;

    IF NEW.stock_qty = 0 THEN
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (v_dono, 'stock',
              'Esgotado: ' || NEW.name,
              'O artigo "' || NEW.name || '" chegou a zero e deixou de poder ser '
              || 'pedido. Reponha o stock para voltar a vende-lo.',
              '/painel-loja/editar');

    ELSIF NEW.stock_qty <= v_limiar AND OLD.stock_qty > v_limiar THEN
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (v_dono, 'stock',
              'Stock baixo: ' || NEW.name,
              'Restam ' || NEW.stock_qty || ' unidade(s) de "' || NEW.name || '".',
              '/painel-loja/editar');
    END IF;

  EXCEPTION WHEN OTHERS THEN
    -- Ver o paragrafo "NUNCA PODE PARTIR UM PEDIDO" acima.
    RAISE NOTICE 'tg_alerta_stock falhou para % : %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_alerta_stock() IS
  'Avisa o dono no atravessamento do limiar para baixo (platform_settings.'
  'stock_low_threshold, omissao 3) e ao chegar a zero. Por transicao e nao por '
  'estado, para nao repetir a cada venda. Engole os proprios erros de proposito '
  '-- corre dentro da transaccao do create_order e nao pode desfazer a venda.';

-- AFTER, e nao BEFORE: o alerta e' sobre um facto consumado. E `OF stock_qty`
-- para nao acordar em cada mudanca de preco ou de foto.
DROP TRIGGER IF EXISTS alerta_stock ON public.menu_items;
CREATE TRIGGER alerta_stock
  AFTER UPDATE OF stock_qty ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_alerta_stock();

-- ---------------------------------------------------------------------------
-- PARTE 3 -- a ronda do meio deixa de ser silenciosa
-- ---------------------------------------------------------------------------
--
-- Igual a' versao da Fase 5 em tudo -- mesma travagem com FOR UPDATE ... SKIP
-- LOCKED, mesma idempotencia, mesmos desfechos verdadeiros para as rondas que
-- entretanto foram aceites ou canceladas -- excepto no ramo do
-- `attempt_number < v_max_attempts`, que ate aqui re-oferecia sem dizer nada a
-- ninguem.
--
-- As notificacoes passam tambem a levar `reference_type`/`reference_id` a
-- apontar para o pedido. Sem isso o cartao de notificacao no frontend nao sabia
-- para onde navegar quando lhe tocavam (so' o `link` estava preenchido, e o
-- `handleClick` so' olhava para o `reference_type`).
CREATE OR REPLACE FUNCTION public.expire_stale_dispatch()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tentativa      record;
  v_max_attempts   integer;
  v_tratadas       integer := 0;
  v_business_owner uuid;
  v_order_number   integer;
  v_notificados    integer;
BEGIN
  SELECT COALESCE(NULLIF(value, '')::integer, 2) INTO v_max_attempts
  FROM public.platform_settings WHERE key = 'dispatch_max_attempts';
  v_max_attempts := COALESCE(v_max_attempts, 2);

  FOR v_tentativa IN
    SELECT da.id, da.delivery_id, da.order_id, da.fleet_id, da.attempt_number,
           d.status AS delivery_status, d.driver_id
    FROM public.dispatch_attempts da
    JOIN public.deliveries d ON d.id = da.delivery_id
    WHERE da.outcome = 'pendente'
      AND da.expires_at < now()
    FOR UPDATE OF d SKIP LOCKED
  LOOP
    IF v_tentativa.driver_id IS NOT NULL THEN
      UPDATE public.dispatch_attempts
      SET outcome = 'aceite', resolved_at = now(), driver_id = v_tentativa.driver_id
      WHERE id = v_tentativa.id AND outcome = 'pendente';
      CONTINUE;
    END IF;

    IF v_tentativa.delivery_status <> 'pendente' THEN
      UPDATE public.dispatch_attempts
      SET outcome = 'cancelada', resolved_at = now(),
          note = 'Entrega passou a ' || v_tentativa.delivery_status || ' antes de expirar'
      WHERE id = v_tentativa.id AND outcome = 'pendente';
      CONTINUE;
    END IF;

    UPDATE public.dispatch_attempts
    SET outcome = 'expirada', resolved_at = now(),
        note = 'Sem resposta em ' || v_tentativa.attempt_number || 'a ronda'
    WHERE id = v_tentativa.id AND outcome = 'pendente';

    v_tratadas := v_tratadas + 1;

    SELECT p.user_id, o.order_number INTO v_business_owner, v_order_number
    FROM public.orders o
    JOIN public.profiles p ON p.id = o.business_id
    WHERE o.id = v_tentativa.order_id;

    IF v_tentativa.attempt_number < v_max_attempts THEN
      -- 2a ronda, mesma frota, mesmo preco -- e, a partir da Fase 2.2, com
      -- aviso. O restaurante fica a saber que a 1a ronda passou em branco em
      -- vez de descobrir so' no esgotamento, 10 minutos depois.
      v_notificados := public.offer_delivery_to_fleet(
        v_tentativa.delivery_id, v_tentativa.attempt_number + 1
      );

      IF v_business_owner IS NOT NULL THEN
        INSERT INTO public.notifications (
          user_id, type, title, body, link, reference_type, reference_id)
        VALUES (v_business_owner, 'dispatch_expirado',
                'Ainda sem motorista',
                'Ninguem aceitou a entrega do pedido #' ||
                COALESCE(v_order_number::text, '?') || ' na ' ||
                v_tentativa.attempt_number || 'a ronda. Foi oferecida outra vez a' ||
                ' mesma frota (' || COALESCE(v_notificados, 0) ||
                ' motorista(s) avisado(s)).',
                '/painel-loja', 'order', v_tentativa.order_id);
      END IF;

      INSERT INTO public.order_status_history (order_id, status, note)
      VALUES (v_tentativa.order_id, 'aguardando_motorista',
              '[Ronda ' || v_tentativa.attempt_number || ' expirou; reoferecida a ' ||
              COALESCE(v_notificados, 0) || ' motorista(s). Restaurante notificado]');
    ELSE
      -- Esgotou. Escala para quem pode decidir: o dono do restaurante e os
      -- admins. O texto diz o que aconteceu e nao promete recuperacao
      -- automatica, porque nao ha' nenhuma a partir daqui (§83).
      IF v_business_owner IS NOT NULL THEN
        INSERT INTO public.notifications (
          user_id, type, title, body, link, reference_type, reference_id)
        VALUES (v_business_owner, 'dispatch_expirado',
                'Pedido sem motorista',
                'O pedido #' || COALESCE(v_order_number::text, '?') ||
                ' continua sem motorista depois de ' || v_max_attempts ||
                ' tentativas. Pode voltar a oferecer ou cancelar.',
                '/painel-loja', 'order', v_tentativa.order_id);
      END IF;

      INSERT INTO public.notifications (
        user_id, type, title, body, link, reference_type, reference_id)
      SELECT ur.user_id, 'dispatch_expirado',
             'Entrega sem motorista',
             'Pedido #' || COALESCE(v_order_number::text, '?') ||
             ' sem motorista apos ' || v_max_attempts || ' tentativas.',
             '/admin', 'order', v_tentativa.order_id
      FROM public.user_roles ur WHERE ur.role = 'admin';

      INSERT INTO public.order_status_history (order_id, status, note)
      VALUES (v_tentativa.order_id, 'aguardando_motorista',
              '[Dispatch esgotado: ' || v_max_attempts ||
              ' rondas sem motorista. Restaurante e admin notificados]');
    END IF;
  END LOOP;

  RETURN v_tratadas;
END;
$$;

COMMENT ON FUNCTION public.expire_stale_dispatch() IS
  'Trabalho periodico (pg_cron, ao minuto): fecha rondas de dispatch vencidas, '
  're-oferece a mesma frota ate dispatch_max_attempts, e depois escala para o '
  'restaurante e os admins. Desde a Fase 2.2 avisa o restaurante TAMBEM nas '
  'rondas do meio; o admin so no esgotamento, para nao virar ruido. '
  'Idempotente. Sem guarda por utilizador de proposito -- corre pelo '
  'agendador; o EXECUTE esta revogado a anon e authenticated.';

REVOKE EXECUTE ON FUNCTION public.expire_stale_dispatch() FROM PUBLIC, anon, authenticated;
