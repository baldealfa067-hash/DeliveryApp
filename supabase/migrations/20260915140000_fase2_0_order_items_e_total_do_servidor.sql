-- FASE 2.0 -- o servidor passa a decidir o que foi vendido e por quanto (§46, §83).
--
-- A FALHA QUE ISTO FECHA. `create_order` recebia `p_items jsonb` e `p_total
-- numeric` do browser e gravava os dois sem olhar para o menu. Um cliente podia
-- mandar `total: 1` num cesto de 10.000 e o pedido entrava assim.
--
-- Nao era so um numero errado num ecra: a comissao do §25 e' 5% de
-- `orders.total`, portanto o valor falsificado ia direito ao ledger da Fase 6 e
-- ficava la' congelado em `base_amount`, com ar de verdade auditada. O ledger
-- estava a somar bem -- estava e' a somar o que o browser mandou.
--
-- E o carrinho ja' tinha o id do prato: `cart[i.id]` indexa por `menu_items.id`
-- e a chamada deitava-o fora, mandando so `{name, price, qty}`. Sem esse id nao
-- ha' stock possivel na 2.1 (descontar de que linha?) nem preco de confianca.
--
-- O QUE MUDA: o total passa a ser CALCULADO a partir de `menu_items`. O
-- `p_total` do cliente deixa de ser gravado e passa a ser so' conferido -- se
-- divergir, o pedido e' recusado em vez de aceite por outro valor. §83 diz que
-- o cliente tem de saber o preco antes de confirmar; cobrar-lhe um numero
-- diferente do que viu e' pior do que falhar a dizer porque'.
--
-- SNAPSHOT DO NOME E DO PRECO, pela mesma razao que o ledger congela
-- `base_amount` e `rate`: renomear um prato ou mudar-lhe o preco amanha nao
-- pode reescrever o que foi vendido ontem.
--
-- `orders.items` (jsonb) FICA. Continua a ser escrito, agora enriquecido com o
-- `menu_item_id`. Ha' 4 pedidos historicos e leitores a depender dele
-- (`get_my_deliveries`, os paineis) -- §19 da instrucao principal: nao apagar
-- dados so' porque ha' agora um sitio melhor.

CREATE TABLE IF NOT EXISTS public.order_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,

  -- SET NULL e nao RESTRICT: o restaurante ha-de poder tirar um prato do menu
  -- sem que isso fique preso a pedidos antigos. O que foi vendido sobrevive no
  -- snapshot abaixo, que e' o que interessa para contas e historico.
  menu_item_id  uuid REFERENCES public.menu_items(id) ON DELETE SET NULL,

  name_snapshot        text    NOT NULL,
  unit_price_snapshot  numeric NOT NULL CHECK (unit_price_snapshot >= 0),
  qty                  integer NOT NULL CHECK (qty > 0),
  line_total           numeric GENERATED ALWAYS AS (unit_price_snapshot * qty) STORED,

  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_items_order    ON public.order_items (order_id);
CREATE INDEX IF NOT EXISTS order_items_menu_item ON public.order_items (menu_item_id);

COMMENT ON TABLE public.order_items IS
  'O que foi vendido em cada pedido, com o id do prato e o preco do momento. '
  'O total do pedido sai daqui, calculado no servidor -- nunca do cliente '
  '(§46). name_snapshot e unit_price_snapshot ficam congelados: mudar o menu '
  'nao reescreve pedidos antigos, tal como em ledger_entries.';

-- ---------------------------------------------------------------------------
-- RLS -- espelha `orders`: cliente, dono do restaurante, admin
-- ---------------------------------------------------------------------------
-- O MOTORISTA nao entra aqui de proposito. Ele ve os artigos pela RPC
-- `get_my_deliveries` (20260910112301), que decide o que expor -- o mesmo
-- padrao da decisao de 2026-09-10 sobre `deliveries`: abrir a tabela a mais um
-- papel expunha-a inteira, a RPC mostra o necessario.
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Order items visiveis a quem ve o pedido" ON public.order_items;
CREATE POLICY "Order items visiveis a quem ve o pedido"
ON public.order_items FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_items.order_id
      AND (
        o.customer_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.profiles p
                   WHERE p.id = o.business_id AND p.user_id = auth.uid())
      )
  )
);

-- Escrita por ninguem: so' `create_order`, que e' SECURITY DEFINER. Se o
-- cliente pudesse escrever aqui, o total voltava a ser dele.
GRANT SELECT ON public.order_items TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.order_items FROM anon, authenticated;
REVOKE SELECT ON public.order_items FROM anon;

-- ---------------------------------------------------------------------------
-- create_order -- o total deixa de vir do cliente
-- ---------------------------------------------------------------------------
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
  v_quantos       integer;
  v_total_calc    numeric := 0;
  v_items_norm    jsonb   := '[]'::jsonb;
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

  -- Resolver cada artigo CONTRA O MENU, e so' entao somar. E' este o passo que
  -- nao existia: o preco vem de `menu_items`, nao do corpo do pedido.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := COALESCE(
      NULLIF(v_item->>'qty', '')::integer,
      NULLIF(v_item->>'quantity', '')::integer,
      0
    );
    -- O carrinho manda linhas a zero (`cart[i.id] ?? 0`); nao sao um erro.
    CONTINUE WHEN v_qty <= 0;

    v_mi_id := NULL;

    IF NULLIF(v_item->>'menu_item_id', '') IS NOT NULL THEN
      SELECT mi.id, mi.name, mi.price INTO v_mi_id, v_mi_nome, v_mi_preco
      FROM public.menu_items mi
      WHERE mi.id = (v_item->>'menu_item_id')::uuid
        AND mi.business_id = p_business_id;

      IF v_mi_id IS NULL THEN
        RAISE EXCEPTION 'Artigo nao pertence a este restaurante';
      END IF;
    ELSE
      -- CAMINHO DE TRANSICAO. O frontend em producao ainda manda so o nome, e
      -- so' se atualiza quando o deploy sair. Resolver pelo nome fecha o buraco
      -- do preco na mesma -- o valor continua a sair do menu -- sem partir a app
      -- que esta' no ar. Sai quando o novo frontend estiver publicado.
      SELECT count(*) INTO v_quantos
      FROM public.menu_items mi
      WHERE mi.business_id = p_business_id
        AND lower(btrim(mi.name)) = lower(btrim(COALESCE(v_item->>'name', '')));

      IF v_quantos = 0 THEN
        RAISE EXCEPTION 'Artigo "%" nao existe no menu deste restaurante', COALESCE(v_item->>'name', '');
      END IF;
      -- Dois pratos com o mesmo nome: nao se adivinha qual, porque na 2.1 e'
      -- de um deles que o stock vai sair.
      IF v_quantos > 1 THEN
        RAISE EXCEPTION 'Artigo "%" aparece mais do que uma vez no menu; o pedido tem de indicar qual', COALESCE(v_item->>'name', '');
      END IF;

      SELECT mi.id, mi.name, mi.price INTO v_mi_id, v_mi_nome, v_mi_preco
      FROM public.menu_items mi
      WHERE mi.business_id = p_business_id
        AND lower(btrim(mi.name)) = lower(btrim(COALESCE(v_item->>'name', '')));
    END IF;

    v_total_calc := v_total_calc + (v_mi_preco * v_qty);

    v_items_norm := v_items_norm || jsonb_build_object(
      'menu_item_id', v_mi_id,
      'name',  v_mi_nome,
      'price', v_mi_preco,
      'qty',   v_qty
    );
  END LOOP;

  IF jsonb_array_length(v_items_norm) = 0 THEN
    RAISE EXCEPTION 'Pedido sem artigos';
  END IF;

  -- §83, principio de nao surpresa: se o que o cliente viu no ecra nao bate
  -- com o menu, o pedido PARA. Aceitar por outro valor era cobrar-lhe um preco
  -- que ele nunca viu -- pior do que falhar e dizer porque.
  IF p_total IS NOT NULL AND round(p_total, 2) <> round(v_total_calc, 2) THEN
    RAISE EXCEPTION 'O preco dos artigos mudou (ecra: %, menu: %). Volte a abrir o menu.',
      round(p_total, 2), round(v_total_calc, 2);
  END IF;

  -- §13/§14: frota e preco vem do bairro, nunca da distancia (§15).
  IF p_consumption_option = 'entrega' AND p_bairro IS NOT NULL THEN
    SELECT gp.fleet_id, gp.preco INTO v_fleet_id, v_delivery_fee
    FROM public.get_delivery_price(p_bairro) gp;
  END IF;

  v_delivery_code := lpad((floor(random() * 1000000))::text, 6, '0');

  SELECT COALESCE(MAX(order_number), 0) + 1 INTO v_order_number
  FROM public.orders WHERE business_id = p_business_id;

  INSERT INTO public.orders (
    business_id, customer_id, customer_name, customer_phone,
    items, total, status, consumption_option,
    address, notes, order_number, delivery_code,
    bairro, customer_lat, customer_lng, voice_note_url,
    payment_method, payment_proof_url, payment_status,
    fleet_id, delivery_fee
  ) VALUES (
    p_business_id,
    p_customer_id,
    btrim(p_customer_name),
    btrim(p_customer_phone),
    v_items_norm,   -- enriquecido com menu_item_id; `items` continua a existir
    v_total_calc,   -- calculado, nao recebido
    'novo',
    p_consumption_option,
    CASE WHEN p_consumption_option = 'entrega' THEN p_address ELSE NULL END,
    p_notes,
    v_order_number,
    v_delivery_code,
    CASE WHEN p_consumption_option = 'entrega' THEN p_bairro ELSE NULL END,
    CASE WHEN p_consumption_option = 'entrega' THEN p_customer_lat ELSE NULL END,
    CASE WHEN p_consumption_option = 'entrega' THEN p_customer_lng ELSE NULL END,
    CASE WHEN p_consumption_option = 'entrega' THEN p_voice_note_url ELSE NULL END,
    p_payment_method,
    p_payment_proof_url,
    'pendente',
    v_fleet_id,
    v_delivery_fee
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (order_id, menu_item_id, name_snapshot, unit_price_snapshot, qty)
  SELECT v_order_id,
         (e->>'menu_item_id')::uuid,
         e->>'name',
         (e->>'price')::numeric,
         (e->>'qty')::integer
  FROM jsonb_array_elements(v_items_norm) e;

  INSERT INTO public.order_status_history (order_id, status, created_by)
  VALUES (v_order_id, 'novo', p_customer_id);

  BEGIN
    INSERT INTO public.provider_activity (provider_id, activity_type)
    VALUES (p_business_id, 'order');
  EXCEPTION WHEN others THEN NULL;
  END;

  SELECT user_id INTO v_owner_id FROM public.profiles WHERE id = p_business_id;
  IF v_owner_id IS NOT NULL AND v_owner_id IS DISTINCT FROM p_customer_id THEN
    PERFORM public.create_notification(
      v_owner_id,
      'Novo Pedido #' || v_order_number,
      btrim(p_customer_name) || ' fez um pedido de ' || v_total_calc || ' FCFA',
      'order', 'order', v_order_id
    );
  END IF;

  RETURN v_order_id;
END;
$function$;

-- PERMISSOES INALTERADAS. Medido antes de escrever isto: `anon` NAO tem
-- EXECUTE nesta funcao (foi-lhe retirado na Fase 1, 20260909160216) e
-- `authenticated` tem. Um CREATE OR REPLACE mantem os privilegios da funcao,
-- portanto nao ha nada a conceder aqui -- e conceder "como estava" de cabeca
-- era reabrir ao anonimo o que a Fase 1 fechou.
REVOKE EXECUTE ON FUNCTION public.create_order(uuid, uuid, text, text, jsonb, numeric, text, text, text, text, double precision, double precision, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_order(uuid, uuid, text, text, jsonb, numeric, text, text, text, text, double precision, double precision, text, text, text) TO authenticated;
