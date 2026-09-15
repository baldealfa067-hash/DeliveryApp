-- FASE 6.1 -- pagamento online: o restaurante deve a taxa de entrega a' frota.
--
-- DECISAO DO DONO DO PROJECTO (2026-09-15). O pagamento online usa o
-- `merchant_code`/`payment_number` DO RESTAURANTE (§23), portanto e' o
-- restaurante que recebe o dinheiro todo do cliente -- comida E entrega. A taxa
-- de entrega e' dinheiro da frota que ficou na mao do restaurante.
--
-- E' o espelho exacto do §28, com os papeis trocados:
--
--   pagamento `entrega`   o motorista recebe tudo   -> FROTA deve a comida ao RESTAURANTE
--   pagamento `online`    o restaurante recebe tudo -> RESTAURANTE deve a entrega a' FROTA
--
-- O QUE FALTAVA ANTES DESTA MIGRACAO: num pedido online escrevia-se a comissao
-- da frota (5% da taxa) mas nao havia linha nenhuma sobre os 1.000 FCFA da taxa
-- em si. A frota via a divida da comissao e nao via o dinheiro que tinha a
-- haver -- §83, a frota tem de saber o que ganhou.
--
-- MESMO DESENHO do §28, e nao um campo com sinal por interpretar: as duas
-- linhas nascem no mesmo bloco, com sinais opostos e contrapartes cruzadas.
-- Cada painel pergunta "o que ha' na MINHA conta" e nenhum ecra inverte sinais
-- por sua conta -- que e' como a direccao se troca.
--
--   divida_entrega    business deve a' fleet      amount > 0
--   credito_entrega   fleet tem a receber         amount < 0

ALTER TABLE public.ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_entry_type_check;
ALTER TABLE public.ledger_entries ADD CONSTRAINT ledger_entries_entry_type_check
  CHECK (entry_type IN (
    'comissao_restaurante',  -- restaurante deve a' plataforma (§25)
    'comissao_frota',        -- frota deve a' plataforma (§26)
    'divida_comida',         -- dinheiro na entrega: frota deve ao restaurante (§28)
    'credito_comida',        -- o outro lado da mesma
    'divida_entrega',        -- online: restaurante deve a taxa a' frota
    'credito_entrega',       -- o outro lado da mesma
    'pagamento_comissao',    -- parceiro pagou, a divida desce (§54)
    'reversao'               -- correccao (§56)
  ));

-- ---------------------------------------------------------------------------
-- O corpo unico de `ledger_registar_conclusao`: ciclo (migracao anterior) +
-- pagamento online (esta). Existe num sitio so' de proposito.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ledger_registar_conclusao(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_business_id  uuid;
  v_total        numeric;
  v_fleet_id     uuid;
  v_delivery_fee numeric;
  v_payment      text;
  v_delivery_id  uuid;
  v_driver_id    uuid;
  v_rate         numeric;
  v_ciclo        smallint;
  v_tem_viva     boolean;
BEGIN
  SELECT o.business_id, COALESCE(o.total,0), o.fleet_id,
         COALESCE(o.delivery_fee,0), COALESCE(o.payment_method,'entrega')
  INTO v_business_id, v_total, v_fleet_id, v_delivery_fee, v_payment
  FROM public.orders o WHERE o.id = p_order_id;

  IF v_business_id IS NULL THEN RETURN; END IF;

  -- §73: ja' ha' entradas VIVAS para este pedido -- nao se escreve outra vez.
  -- E' isto que aguenta refresh, retry e push duplicado.
  SELECT EXISTS (
    SELECT 1 FROM public.ledger_entries e
    WHERE e.order_id = p_order_id
      AND e.reverses_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.ledger_entries r WHERE r.reverses_id = e.id)
  ) INTO v_tem_viva;

  IF v_tem_viva THEN RETURN; END IF;

  -- Sem entradas, ou com as anteriores todas revertidas: abre-se a volta
  -- seguinte. As linhas velhas ficam onde estao (§56).
  SELECT COALESCE(MAX(e.ciclo), 0) + 1 INTO v_ciclo
  FROM public.ledger_entries e
  WHERE e.order_id = p_order_id AND e.reverses_id IS NULL;

  SELECT d.id, d.driver_id INTO v_delivery_id, v_driver_id
  FROM public.deliveries d WHERE d.order_id = p_order_id;

  -- A taxa e' lida UMA vez, aqui, e fica gravada em cada linha. A partir deste
  -- momento mudar platform_settings nao toca nestas entradas (§84).
  SELECT COALESCE(NULLIF(value,'')::numeric, 5) INTO v_rate
  FROM public.platform_settings WHERE key = 'commission_rate';
  v_rate := COALESCE(v_rate, 5);

  -- 1. Comissao do restaurante sobre a comida (§25). `orders.total` e' SO' a
  -- comida -- a taxa de entrega vive em `delivery_fee` desde a Fase 3.
  IF v_total > 0 THEN
    INSERT INTO public.ledger_entries (
      entry_type, account_kind, counterparty, business_id, order_id,
      delivery_id, amount, base_amount, rate, ciclo, note)
    VALUES ('comissao_restaurante','business','platform', v_business_id, p_order_id,
            v_delivery_id, ROUND(v_total * v_rate / 100, 0), v_total, v_rate, v_ciclo,
            'Comissao sobre a venda')
    ON CONFLICT (entry_type, order_id, ciclo) WHERE order_id IS NOT NULL AND reverses_id IS NULL DO NOTHING;
  END IF;

  -- 2. Comissao da frota sobre a taxa de entrega (§26).
  IF v_fleet_id IS NOT NULL AND v_delivery_fee > 0 THEN
    INSERT INTO public.ledger_entries (
      entry_type, account_kind, counterparty, fleet_id, driver_id, order_id,
      delivery_id, amount, base_amount, rate, ciclo, note)
    VALUES ('comissao_frota','fleet','platform', v_fleet_id, v_driver_id, p_order_id,
            v_delivery_id, ROUND(v_delivery_fee * v_rate / 100, 0), v_delivery_fee, v_rate, v_ciclo,
            'Comissao sobre a taxa de entrega')
    ON CONFLICT (entry_type, order_id, ciclo) WHERE order_id IS NOT NULL AND reverses_id IS NULL DO NOTHING;
  END IF;

  -- 3. Dinheiro na entrega (§28): o cliente paga ao MOTORISTA, que fica com a
  -- taxa e deve a comida ao restaurante. Sentido confirmado em 2026-09-10.
  IF v_payment = 'entrega' AND v_fleet_id IS NOT NULL AND v_total > 0 THEN
    INSERT INTO public.ledger_entries (
      entry_type, account_kind, counterparty, fleet_id, business_id, driver_id,
      order_id, delivery_id, amount, base_amount, ciclo, note)
    VALUES ('divida_comida','fleet','business', v_fleet_id, v_business_id, v_driver_id,
            p_order_id, v_delivery_id, v_total, v_total, v_ciclo,
            'Valor da comida recebido em dinheiro pelo motorista')
    ON CONFLICT (entry_type, order_id, ciclo) WHERE order_id IS NOT NULL AND reverses_id IS NULL DO NOTHING;

    INSERT INTO public.ledger_entries (
      entry_type, account_kind, counterparty, business_id, fleet_id, driver_id,
      order_id, delivery_id, amount, base_amount, ciclo, note)
    VALUES ('credito_comida','business','fleet', v_business_id, v_fleet_id, v_driver_id,
            p_order_id, v_delivery_id, -v_total, v_total, v_ciclo,
            'Valor da comida a receber da frota')
    ON CONFLICT (entry_type, order_id, ciclo) WHERE order_id IS NOT NULL AND reverses_id IS NULL DO NOTHING;
  END IF;

  -- 4. Pagamento online (decisao de 2026-09-15): o cliente paga ao
  -- RESTAURANTE, pelo merchant_code dele (§23). O restaurante ficou com a taxa
  -- de entrega, que e' da frota. Espelho do §28, papeis trocados.
  IF v_payment = 'online' AND v_fleet_id IS NOT NULL AND v_delivery_fee > 0 THEN
    INSERT INTO public.ledger_entries (
      entry_type, account_kind, counterparty, business_id, fleet_id, driver_id,
      order_id, delivery_id, amount, base_amount, ciclo, note)
    VALUES ('divida_entrega','business','fleet', v_business_id, v_fleet_id, v_driver_id,
            p_order_id, v_delivery_id, v_delivery_fee, v_delivery_fee, v_ciclo,
            'Taxa de entrega recebida do cliente, a entregar a frota')
    ON CONFLICT (entry_type, order_id, ciclo) WHERE order_id IS NOT NULL AND reverses_id IS NULL DO NOTHING;

    INSERT INTO public.ledger_entries (
      entry_type, account_kind, counterparty, fleet_id, business_id, driver_id,
      order_id, delivery_id, amount, base_amount, ciclo, note)
    VALUES ('credito_entrega','fleet','business', v_fleet_id, v_business_id, v_driver_id,
            p_order_id, v_delivery_id, -v_delivery_fee, v_delivery_fee, v_ciclo,
            'Taxa de entrega a receber do restaurante')
    ON CONFLICT (entry_type, order_id, ciclo) WHERE order_id IS NOT NULL AND reverses_id IS NULL DO NOTHING;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ledger_registar_conclusao(uuid) FROM PUBLIC, anon, authenticated;
