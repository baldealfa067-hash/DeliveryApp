-- FASE 2.1 -- stock real por quantidade, descontado atomicamente (§71, §72, §73).
--
-- DUAS CORRECCOES DA MESMA FAMILIA. O desconto de stock e a atribuicao do
-- `order_number` sao ambos ler-depois-escrever sem serializacao:
--
--   stock         ler 1 disponivel -> decidir -> escrever 0
--   order_number  SELECT MAX(order_number) + 1
--
-- Em ambos, dois pedidos simultaneos leem o MESMO valor antes de qualquer um
-- escrever, e os dois "ganham": duas pessoas compram o ultimo frango, ou dois
-- pedidos ficam com o numero 7. Nao da erro nenhum -- e' o pior tipo de avaria.
--
-- COMO SE RESOLVE, e porque nao e com um SELECT antes. A decisao tem de estar
-- DENTRO do UPDATE, na clausula WHERE:
--
--   UPDATE menu_items SET stock_qty = stock_qty - :q
--    WHERE id = :id AND stock_qty >= :q
--
-- O Postgres bloqueia a linha; a segunda transaccao espera, e quando o lock
-- larga REAVALIA o WHERE contra a versao nova da linha (EvalPlanQual, em READ
-- COMMITTED). Ve stock 0, a condicao falha, nao actualiza nada, e o
-- `IF NOT FOUND` recusa o pedido. Exactamente um ganha, sempre.
--
-- Para o numero do pedido, um contador por restaurante com
-- `ON CONFLICT DO UPDATE ... RETURNING`, que serializa da mesma maneira. Mais
-- um indice unico como rede: se algum caminho futuro voltar a calcular o numero
-- a mao, rebenta em vez de duplicar em silencio.
--
-- DISPONIBILIDADE: o interruptor do dono e a quantidade sao COISAS DIFERENTES.
-- `is_available` e a decisao do restaurante ("hoje nao faco isto"); `stock_qty`
-- e quanto resta. Se o esgotamento escrevesse por cima de `is_available`,
-- repor o stock nao saberia se devia voltar a ligar o prato ou se o dono o
-- tinha desligado de proposito. Por isso ha uma terceira coluna, DERIVADA:
-- `is_orderable`. Chegar a zero torna o prato impossivel de pedir sem apagar a
-- vontade do dono, e repor volta a liga-lo sozinho.

-- ---------------------------------------------------------------------------
-- 1. Colunas de stock
-- ---------------------------------------------------------------------------
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS track_stock  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stock_qty    integer,
  ADD COLUMN IF NOT EXISTS is_available boolean NOT NULL DEFAULT true;

-- Seguir stock exige ter quantidade. Sem isto era possivel ligar o controlo e
-- ficar com NULL, que nao e' zero nem infinito -- e o desconto nao sabia o que
-- fazer.
ALTER TABLE public.menu_items DROP CONSTRAINT IF EXISTS menu_items_stock_coerente;
ALTER TABLE public.menu_items ADD CONSTRAINT menu_items_stock_coerente
  CHECK ((track_stock = false) OR (stock_qty IS NOT NULL AND stock_qty >= 0));

ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS is_orderable boolean
  GENERATED ALWAYS AS (is_available AND (NOT track_stock OR COALESCE(stock_qty, 0) > 0)) STORED;

COMMENT ON COLUMN public.menu_items.is_available IS
  'O interruptor do DONO. Nada automatico lhe toca.';
COMMENT ON COLUMN public.menu_items.stock_qty IS
  'Quantas restam. So muda por set_menu_item_stock ou pelo desconto do '
  'create_order -- o UPDATE directo esta revogado a coluna.';
COMMENT ON COLUMN public.menu_items.is_orderable IS
  'Derivada: o dono quer vender E ainda ha. E esta que a loja deve filtrar.';

-- O dono deixa de poder escrever stock a mao: senao o registo de ajustes
-- abaixo era so decorativo, e a policy `Menu items owner manage [ALL]` dava-lhe
-- UPDATE directo na coluna.
REVOKE UPDATE ON public.menu_items FROM authenticated;
GRANT  UPDATE (name, price, photo_url, category_id, is_available)
  ON public.menu_items TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Registo de ajustes (§30 aplicado ao stock: nunca so mudar um numero)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_adjustments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  order_id     uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  delta        integer NOT NULL,
  qty_antes    integer,
  qty_depois   integer,
  motivo       text NOT NULL,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stock_adjustments_item  ON public.stock_adjustments (menu_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stock_adjustments_order ON public.stock_adjustments (order_id);

COMMENT ON TABLE public.stock_adjustments IS
  'Porque e que a quantidade mudou. Venda, reposicao, devolucao por '
  'cancelamento. Mesma ideia do ledger: o saldo explica-se, nao se afirma.';

ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Ajustes visiveis ao dono do menu" ON public.stock_adjustments;
CREATE POLICY "Ajustes visiveis ao dono do menu"
ON public.stock_adjustments FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.menu_items mi
    JOIN public.profiles p ON p.id = mi.business_id
    WHERE mi.id = stock_adjustments.menu_item_id AND p.user_id = auth.uid()
  )
);

GRANT SELECT ON public.stock_adjustments TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.stock_adjustments FROM anon, authenticated;
REVOKE SELECT ON public.stock_adjustments FROM anon;

-- ---------------------------------------------------------------------------
-- 3. Contador de numero de pedido, por restaurante
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_order_counters (
  business_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_number integer NOT NULL DEFAULT 0
);

-- Arranca de onde os pedidos existentes ficaram, senao o proximo pedido de um
-- restaurante com historico recebia o numero 1 outra vez.
INSERT INTO public.business_order_counters (business_id, last_number)
SELECT business_id, MAX(order_number) FROM public.orders
WHERE business_id IS NOT NULL
GROUP BY business_id
ON CONFLICT (business_id) DO UPDATE
  SET last_number = GREATEST(business_order_counters.last_number, EXCLUDED.last_number);

ALTER TABLE public.business_order_counters ENABLE ROW LEVEL SECURITY;
-- Sem policies: e' uma peca interna do `create_order` (SECURITY DEFINER).
-- Ninguem tem negocio nenhum a ler ou escrever isto directamente.
REVOKE ALL ON public.business_order_counters FROM anon, authenticated;

-- Rede de seguranca: medido antes de criar -- zero duplicados hoje.
CREATE UNIQUE INDEX IF NOT EXISTS orders_numero_unico_por_restaurante
  ON public.orders (business_id, order_number);

-- Marca de devolucao, para um cancelamento repetido nao devolver duas vezes.
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS stock_returned_at timestamptz;

-- ---------------------------------------------------------------------------
-- 4. Repor/ajustar stock -- o unico caminho de escrita do dono
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_menu_item_stock(
  p_menu_item_id uuid,
  p_stock_qty    integer,
  p_track        boolean DEFAULT true,
  p_motivo       text    DEFAULT 'Reposicao'
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_business uuid;
  v_dono     uuid;
  v_antes    integer;
BEGIN
  SELECT mi.business_id, p.user_id, mi.stock_qty
  INTO v_business, v_dono, v_antes
  FROM public.menu_items mi
  JOIN public.profiles p ON p.id = mi.business_id
  WHERE mi.id = p_menu_item_id;

  IF v_business IS NULL THEN
    RAISE EXCEPTION 'Artigo nao encontrado';
  END IF;
  IF v_dono IS DISTINCT FROM auth.uid() AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  IF p_track AND (p_stock_qty IS NULL OR p_stock_qty < 0) THEN
    RAISE EXCEPTION 'Quantidade invalida';
  END IF;

  UPDATE public.menu_items
     SET track_stock = p_track,
         stock_qty   = CASE WHEN p_track THEN p_stock_qty ELSE NULL END
   WHERE id = p_menu_item_id;

  -- §30 aplicado ao stock: a quantidade nova explica-se, nao se afirma.
  INSERT INTO public.stock_adjustments (
    menu_item_id, delta, qty_antes, qty_depois, motivo, created_by)
  VALUES (
    p_menu_item_id,
    COALESCE(p_stock_qty, 0) - COALESCE(v_antes, 0),
    v_antes,
    CASE WHEN p_track THEN p_stock_qty ELSE NULL END,
    p_motivo,
    auth.uid());

  RETURN CASE WHEN p_track THEN p_stock_qty ELSE NULL END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_menu_item_stock(uuid, integer, boolean, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_menu_item_stock(uuid, integer, boolean, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Cancelar devolve o stock -- uma vez so
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_stock_devolve_no_cancelamento()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r      record;
  v_novo integer;
BEGIN
  IF NEW.status = 'cancelado' AND OLD.status IS DISTINCT FROM 'cancelado' THEN
    FOR r IN
      SELECT oi.id, oi.menu_item_id, oi.qty
      FROM public.order_items oi
      WHERE oi.order_id = NEW.id
        AND oi.stock_returned_at IS NULL
        AND oi.menu_item_id IS NOT NULL
    LOOP
      UPDATE public.menu_items
         SET stock_qty = stock_qty + r.qty
       WHERE id = r.menu_item_id AND track_stock = true
      RETURNING stock_qty INTO v_novo;

      IF FOUND THEN
        INSERT INTO public.stock_adjustments (
          menu_item_id, order_id, delta, qty_antes, qty_depois, motivo, created_by)
        VALUES (r.menu_item_id, NEW.id, r.qty, v_novo - r.qty, v_novo,
                'Devolucao por cancelamento', auth.uid());
      END IF;

      -- Marca-se sempre, mesmo que o artigo ja nao siga stock: o que nao pode
      -- acontecer e' um segundo cancelamento devolver outra vez.
      UPDATE public.order_items SET stock_returned_at = now() WHERE id = r.id;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stock_devolve_no_cancelamento ON public.orders;
CREATE TRIGGER stock_devolve_no_cancelamento
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_stock_devolve_no_cancelamento();

-- ---------------------------------------------------------------------------
-- 6. create_order -- numero atomico e desconto atomico
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

REVOKE EXECUTE ON FUNCTION public.create_order(uuid, uuid, text, text, jsonb, numeric, text, text, text, text, double precision, double precision, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_order(uuid, uuid, text, text, jsonb, numeric, text, text, text, text, double precision, double precision, text, text, text) TO authenticated;
