-- FASE 2.4 -- lancar um pedido que nao veio pela aplicacao.
--
-- QUEM CHAMA: o dono do restaurante, para o SEU restaurante. Nao ha parametro
-- de identidade -- o papel sai de `auth.uid()` (§46).
--
-- O TOTAL NAO VEM DO ECRA. Mesma disciplina da Fase 2.0: os artigos sao
-- resolvidos contra o menu e o total e somado aqui. Parece excessivo quando
-- quem escreve e o proprio dono -- mas o dono tambem se engana a somar, e o
-- valor entra no ledger e na divida da frota (§28). Um total que venha do
-- browser e um total em que ninguem mandou.
--
-- DECISAO 3 -- O STOCK DESCONTA AQUI, na criacao, e nao numa confirmacao
-- posterior. Um pedido manual e um facto ja consumado quando e lancado: a
-- comida saiu. Usa-se exactamente o mesmo UPDATE atomico da Fase 2.1, com a
-- decisao dentro do WHERE, porque um pedido manual e um pedido da aplicacao
-- podem disputar a ultima unidade ao mesmo tempo.
--
-- ESTADO INICIAL `confirmado`, e nao `novo`: o restaurante aceitou o pedido no
-- momento em que o escreveu. Nao ha ninguem para o confirmar a seguir.
--
-- PORQUE `p_concluir` PASSA PELA MATRIZ em vez de escrever 'concluido' de uma
-- vez: o trigger do ledger e AFTER UPDATE OF status. Um INSERT directo com
-- status='concluido' NAO o dispara, e o pedido ficava sem lancamento nenhum --
-- sem divida de comida a frota, sem nada. Em vez de chamar o ledger a mao por
-- um segundo caminho (que e onde os dois caminhos passam a divergir), faz-se a
-- venda ao balcao andar pela matriz normal. Um caminho so ate ao ledger.
CREATE OR REPLACE FUNCTION public.create_manual_order(
  p_business_id        uuid,
  p_items              jsonb,
  p_consumption_option text,
  p_customer_name      text DEFAULT NULL,
  p_customer_phone     text DEFAULT NULL,
  p_address            text DEFAULT NULL,
  p_bairro             text DEFAULT NULL,
  p_notes              text DEFAULT NULL,
  p_payment_method     text DEFAULT 'entrega',
  p_concluir           boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order_id     uuid;
  v_order_number integer;
  v_fleet_id     uuid;
  v_delivery_fee numeric;
  v_item         jsonb;
  v_qty          integer;
  v_mi_id        uuid;
  v_mi_nome      text;
  v_mi_preco     numeric;
  v_mi_disp      boolean;
  v_quantos      integer;
  v_total        numeric := 0;
  v_items_norm   jsonb   := '[]'::jsonb;
  v_novo_stock   integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessao'; END IF;

  IF NOT public.is_business_owner(p_business_id)
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'So o dono do restaurante pode lancar um pedido manual';
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

  -- Concluir de imediato so faz sentido no balcao. Com entrega ha um motorista
  -- pelo meio e o pedido tem de passar pelo dispatch.
  IF p_concluir AND p_consumption_option = 'entrega' THEN
    RAISE EXCEPTION 'Um pedido com entrega nao pode ser dado como concluido na criacao';
  END IF;

  -- Resolver contra o menu e somar dai (mesma regra da Fase 2.0).
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := COALESCE(
      NULLIF(v_item->>'qty', '')::integer,
      NULLIF(v_item->>'quantity', '')::integer,
      0);
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
      SELECT count(*) INTO v_quantos FROM public.menu_items mi
      WHERE mi.business_id = p_business_id
        AND lower(btrim(mi.name)) = lower(btrim(COALESCE(v_item->>'name', '')));
      IF v_quantos = 0 THEN
        RAISE EXCEPTION 'Artigo "%" nao existe no menu', COALESCE(v_item->>'name', '');
      END IF;
      IF v_quantos > 1 THEN
        RAISE EXCEPTION 'Artigo "%" aparece mais do que uma vez no menu; indique qual', COALESCE(v_item->>'name', '');
      END IF;
      SELECT mi.id, mi.name, mi.price, mi.is_available
      INTO v_mi_id, v_mi_nome, v_mi_preco, v_mi_disp
      FROM public.menu_items mi
      WHERE mi.business_id = p_business_id
        AND lower(btrim(mi.name)) = lower(btrim(COALESCE(v_item->>'name', '')));
    END IF;

    -- O interruptor do dono continua a valer: se ele desligou o prato, nao o
    -- vende nem a mao. O stock em si e tratado no desconto, la abaixo.
    IF NOT v_mi_disp THEN
      RAISE EXCEPTION 'O artigo "%" esta desligado no menu', v_mi_nome;
    END IF;

    v_total := v_total + (v_mi_preco * v_qty);
    v_items_norm := v_items_norm || jsonb_build_object(
      'menu_item_id', v_mi_id, 'name', v_mi_nome, 'price', v_mi_preco, 'qty', v_qty);
  END LOOP;

  IF jsonb_array_length(v_items_norm) = 0 THEN
    RAISE EXCEPTION 'Pedido sem artigos';
  END IF;

  -- Decisao 2: a entrega e opcional. Quando existe, resolve-se a frota e o
  -- preco do bairro exactamente como num pedido da aplicacao -- mesmo dispatch.
  IF p_consumption_option = 'entrega' AND p_bairro IS NOT NULL THEN
    SELECT gp.fleet_id, gp.preco INTO v_fleet_id, v_delivery_fee
    FROM public.get_delivery_price(p_bairro) gp;
  END IF;

  INSERT INTO public.business_order_counters (business_id, last_number)
  VALUES (p_business_id, 1)
  ON CONFLICT (business_id) DO UPDATE
    SET last_number = public.business_order_counters.last_number + 1
  RETURNING last_number INTO v_order_number;

  INSERT INTO public.orders (
    business_id, customer_id, customer_name, customer_phone,
    items, total, status, consumption_option, source,
    address, notes, order_number, delivery_code, bairro,
    payment_method, payment_status, fleet_id, delivery_fee
  ) VALUES (
    p_business_id,
    NULL,                                   -- nao ha conta de cliente por tras
    COALESCE(NULLIF(btrim(COALESCE(p_customer_name, '')), ''), 'Cliente do balcao'),
    NULLIF(btrim(COALESCE(p_customer_phone, '')), ''),
    v_items_norm, v_total, 'confirmado', p_consumption_option, 'manual',
    CASE WHEN p_consumption_option = 'entrega' THEN p_address ELSE NULL END,
    p_notes, v_order_number,
    lpad((floor(random() * 1000000))::text, 6, '0'),
    CASE WHEN p_consumption_option = 'entrega' THEN p_bairro ELSE NULL END,
    p_payment_method, 'pendente', v_fleet_id, v_delivery_fee
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (order_id, menu_item_id, name_snapshot, unit_price_snapshot, qty)
  SELECT v_order_id, (e->>'menu_item_id')::uuid, e->>'name',
         (e->>'price')::numeric, (e->>'qty')::integer
  FROM jsonb_array_elements(v_items_norm) e;

  -- DESCONTO DE STOCK (decisao 3). Decisao dentro do UPDATE, como na Fase 2.1:
  -- e a clausula WHERE que e reavaliada depois do lock largar, e e por isso que
  -- um pedido manual e um pedido da app nao ganham os dois a ultima unidade.
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items_norm) LOOP
    v_mi_id := (v_item->>'menu_item_id')::uuid;
    v_qty   := (v_item->>'qty')::integer;

    UPDATE public.menu_items
       SET stock_qty = stock_qty - v_qty
     WHERE id = v_mi_id AND track_stock = true AND stock_qty >= v_qty
    RETURNING stock_qty INTO v_novo_stock;

    IF FOUND THEN
      INSERT INTO public.stock_adjustments (
        menu_item_id, order_id, delta, qty_antes, qty_depois, motivo, created_by)
      VALUES (v_mi_id, v_order_id, -v_qty, v_novo_stock + v_qty, v_novo_stock,
              'Venda (pedido manual)', auth.uid());
    ELSE
      IF EXISTS (SELECT 1 FROM public.menu_items WHERE id = v_mi_id AND track_stock = true) THEN
        RAISE EXCEPTION 'Sem stock suficiente de "%"', v_item->>'name';
      END IF;
    END IF;
  END LOOP;

  INSERT INTO public.order_status_history (order_id, status, note, created_by)
  VALUES (v_order_id, 'confirmado', '[Pedido lancado a mao pelo restaurante]', auth.uid());

  -- Venda ao balcao: anda pela matriz normal ate concluido, para o ledger ser
  -- escrito pelo unico caminho que o sabe escrever.
  IF p_concluir THEN
    PERFORM public.update_order_status(v_order_id, 'em_preparacao');
    PERFORM public.update_order_status(v_order_id, 'pronto');
    PERFORM public.update_order_status(v_order_id, 'concluido');
  END IF;

  RETURN v_order_id;
END;
$$;

COMMENT ON FUNCTION public.create_manual_order(uuid, jsonb, text, text, text, text, text, text, text, boolean) IS
  'Fase 2.4: pedido lancado a mao pelo restaurante (telefone, balcao). Mesma '
  'tabela `orders`, marcado source=manual, que o isenta de comissao (decisao 5) '
  'sem o isentar da divida de comida a frota (§28). Stock desconta aqui, na '
  'criacao (decisao 3). Total somado do menu, nunca recebido do ecra.';

REVOKE EXECUTE ON FUNCTION public.create_manual_order(uuid, jsonb, text, text, text, text, text, text, text, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_manual_order(uuid, jsonb, text, text, text, text, text, text, text, boolean) TO authenticated;
