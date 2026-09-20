-- Fase 9.4 — Avaliações (§38), decidido com o dono a 2026-09-20.
--
-- Avalia-se o RESTAURANTE e o MOTORISTA, sempre a partir de um pedido CONCLUÍDO,
-- pelo cliente desse pedido, uma vez cada. Sem inserção anónima. Sem sistema de
-- penalização: §38 manda esperar por dados antes disso.
--
-- NÃO reaproveita a tabela `reviews` do Bornaal (`provider_id` + `service_requests`),
-- que fica de pé para a vertical de beleza. Aquela é uma montra sem pedido por trás;
-- esta só existe agarrada a um pedido. Juntá-las dava uma média que mistura quem
-- comprou com quem passou pela página.
--
-- Três decisões do dono nesta migração:
--   1. O formulário aberto da página do restaurante SAI. Enquanto existisse, o
--      caminho antigo (sem pedido, anónimo) continuava aberto e tornava este
--      decorativo.
--   2. A policy de INSERT anónimo em `reviews` é REMOVIDA por inteiro -- também
--      para a beleza. Custo real zero: a tabela nunca teve uma linha. Isto
--      contraria a nota da Fase 1 que a dava como "de propósito"; o CLAUDE.md
--      foi corrigido no mesmo passo.
--   3. A avaliação aparece LOGO. Quem avalia já provou que fez o pedido, portanto
--      a fraude que a moderação travava está travada à entrada. O admin mantém
--      poder de apagar uma avaliação abusiva.

-- 1. Tabela --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_ratings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target      text NOT NULL CHECK (target IN ('restaurante', 'motorista')),
  business_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- ON DELETE SET NULL de propósito: se um motorista sair, a avaliação do pedido
  -- não desaparece (§56). Fica sem dono, contada na média do restaurante na mesma.
  driver_id   uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  rating      smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     text,
  -- Copiado do pedido no momento de avaliar: a leitura é pública e não pode
  -- depender de um JOIN a `profiles`/`auth.users` para mostrar um nome.
  customer_name text,
  created_at  timestamptz NOT NULL DEFAULT now(),

  -- Uma avaliação por pedido e por alvo. É a regra "não avaliar duas vezes",
  -- imposta pelo índice e não por um SELECT antes do INSERT, que perde a corrida
  -- entre dois toques no botão (§73).
  CONSTRAINT order_ratings_uma_por_alvo UNIQUE (order_id, target),

  -- O alvo e a coluna preenchida têm de concordar. Sem isto cabia uma avaliação
  -- de "motorista" com `business_id` preenchido, que ninguém somaria a lado nenhum.
  CONSTRAINT order_ratings_alvo_coerente CHECK (
    (target = 'restaurante' AND business_id IS NOT NULL AND driver_id IS NULL)
    OR (target = 'motorista' AND business_id IS NULL)
  )
);

COMMENT ON TABLE public.order_ratings IS
  'Avaliacoes de restaurante e motorista agarradas a um pedido concluido (Fase 9.4, '
  '2026-09-20). Escreve-se SO pela RPC rate_order: authenticated nao tem INSERT aqui. '
  'A tabela reviews (Bornaal/beleza) e outra coisa e nao se mistura com esta.';

CREATE INDEX IF NOT EXISTS order_ratings_business_idx ON public.order_ratings(business_id) WHERE business_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS order_ratings_driver_idx   ON public.order_ratings(driver_id)   WHERE driver_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS order_ratings_customer_idx ON public.order_ratings(customer_id);

-- 2. RLS -----------------------------------------------------------------------
ALTER TABLE public.order_ratings ENABLE ROW LEVEL SECURITY;

-- Leitura pública: é a montra do restaurante, e o cliente vê-a antes de ter conta,
-- como já vê o menu.
DROP POLICY IF EXISTS "Avaliacoes sao publicas" ON public.order_ratings;
CREATE POLICY "Avaliacoes sao publicas" ON public.order_ratings
  FOR SELECT TO anon, authenticated USING (true);

-- O admin apaga uma avaliação abusiva (a decisão 3 troca moderação prévia por isto).
DROP POLICY IF EXISTS "Admin apaga avaliacoes" ON public.order_ratings;
CREATE POLICY "Admin apaga avaliacoes" ON public.order_ratings
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Sem policy de INSERT e sem policy de UPDATE, de propósito:
--   INSERT -- só pela RPC `rate_order`, que deriva o restaurante e o motorista do
--             próprio pedido. Com INSERT directo, o cliente escolhia a quem dava a
--             estrela, e um 5 no seu restaurante preferido não custava um pedido.
--   UPDATE -- uma avaliação não se reescreve. Se estiver errada, o admin apaga-a.
REVOKE INSERT, UPDATE, DELETE ON public.order_ratings FROM anon, authenticated;
GRANT SELECT ON public.order_ratings TO anon, authenticated;

-- 3. Escrita: a única porta ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.rate_order(
  p_order_id uuid,
  p_target   text,
  p_rating   smallint,
  p_comment  text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_order     public.orders%ROWTYPE;
  v_driver_id uuid;
  v_comment   text := NULLIF(btrim(COALESCE(p_comment, '')), '');
  v_id        uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Nao autenticado'; END IF;
  IF p_target NOT IN ('restaurante', 'motorista') THEN
    RAISE EXCEPTION 'Alvo invalido: %', p_target;
  END IF;
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'A avaliacao tem de ser de 1 a 5 estrelas';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido nao encontrado'; END IF;

  -- Só o cliente DESTE pedido. Nem o restaurante, nem o motorista, nem o admin:
  -- uma avaliação é a opinião de quem recebeu o serviço.
  IF v_order.customer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Só o cliente do pedido o pode avaliar';
  END IF;

  -- `concluido` e não `entregue`: os dois foram fundidos na Fase 1.
  IF v_order.status <> 'concluido' THEN
    RAISE EXCEPTION 'Só se avalia um pedido concluido (este esta em "%")', v_order.status;
  END IF;

  IF p_target = 'restaurante' THEN
    -- Um envio (Fase 7) não tem restaurante: não há quem avaliar.
    IF v_order.business_id IS NULL THEN
      RAISE EXCEPTION 'Este pedido nao tem restaurante para avaliar';
    END IF;
  ELSE
    -- O motorista sai da entrega, não de um parâmetro: quem avalia não escolhe
    -- quem está a avaliar.
    SELECT d.driver_id INTO v_driver_id
    FROM public.deliveries d
    WHERE d.order_id = p_order_id AND d.driver_id IS NOT NULL
    ORDER BY d.delivered_at DESC NULLS LAST, d.accepted_at DESC NULLS LAST, d.created_at DESC
    LIMIT 1;
    IF v_driver_id IS NULL THEN
      RAISE EXCEPTION 'Este pedido nao teve motorista para avaliar';
    END IF;
  END IF;

  INSERT INTO public.order_ratings (order_id, customer_id, target, business_id, driver_id,
                                    rating, comment, customer_name)
  VALUES (p_order_id, v_uid, p_target,
          CASE WHEN p_target = 'restaurante' THEN v_order.business_id END,
          v_driver_id, p_rating, v_comment, v_order.customer_name)
  RETURNING id INTO v_id;

  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN
    -- A corrida entre dois toques no botão acaba aqui, com uma frase que o cliente
    -- percebe, em vez do texto do índice (§73, §52).
    RAISE EXCEPTION 'Este pedido ja foi avaliado';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rate_order(uuid, text, smallint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rate_order(uuid, text, smallint, text) TO authenticated;

-- 4. Leitura: o que o cliente ainda pode avaliar -------------------------------
-- Uma chamada só para a lista toda. Per-pedido dava N+1, e `get_customer_orders`
-- não é tocada: mudar o tipo de retorno de uma função viva obriga a DROP, e esta
-- é o caminho do ecrã de pedidos do cliente.
CREATE OR REPLACE FUNCTION public.get_my_rateable_orders()
RETURNS TABLE (
  order_id             uuid,
  pode_avaliar_restaurante boolean,
  pode_avaliar_motorista   boolean,
  avaliou_restaurante      boolean,
  avaliou_motorista        boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nao autenticado'; END IF;

  RETURN QUERY
  SELECT
    o.id,
    (o.business_id IS NOT NULL),
    (mot.driver_id IS NOT NULL),
    EXISTS (SELECT 1 FROM public.order_ratings r
             WHERE r.order_id = o.id AND r.target = 'restaurante'),
    EXISTS (SELECT 1 FROM public.order_ratings r
             WHERE r.order_id = o.id AND r.target = 'motorista')
  FROM public.orders o
  LEFT JOIN LATERAL (
    SELECT d.driver_id FROM public.deliveries d
    WHERE d.order_id = o.id AND d.driver_id IS NOT NULL
    ORDER BY d.delivered_at DESC NULLS LAST, d.accepted_at DESC NULLS LAST, d.created_at DESC
    LIMIT 1
  ) mot ON true
  WHERE o.customer_id = auth.uid() AND o.status = 'concluido';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_rateable_orders() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_my_rateable_orders() TO authenticated;

-- 5. Média de um restaurante ---------------------------------------------------
-- Pública: a página do restaurante abre sem sessão. Devolve só números agregados,
-- não a lista -- essa lê-se da tabela, que tem SELECT público.
CREATE OR REPLACE FUNCTION public.get_business_rating(p_business_id uuid)
RETURNS TABLE (media numeric, total bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT ROUND(AVG(r.rating)::numeric, 2), COUNT(*)
  FROM public.order_ratings r
  WHERE r.business_id = p_business_id AND r.target = 'restaurante';
$$;

GRANT EXECUTE ON FUNCTION public.get_business_rating(uuid) TO anon, authenticated;

-- 6. Média do motorista, para o próprio e para a sua frota ---------------------
CREATE OR REPLACE FUNCTION public.get_driver_rating(p_driver_id uuid)
RETURNS TABLE (media numeric, total bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nao autenticado'; END IF;
  -- O próprio motorista, o dono da frota a que pertence, ou o admin. A média de um
  -- motorista não é montra pública: §38 não pede isso, e expô-la era o primeiro
  -- passo para a penalização que §38 manda adiar.
  IF NOT EXISTS (
    SELECT 1 FROM public.drivers d
    LEFT JOIN public.fleets f ON f.id = d.fleet_id
    WHERE d.id = p_driver_id
      AND (d.user_id = auth.uid() OR f.owner_user_id = auth.uid()
           OR public.has_role(auth.uid(), 'admin'))
  ) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT ROUND(AVG(r.rating)::numeric, 2), COUNT(*)
  FROM public.order_ratings r
  WHERE r.driver_id = p_driver_id AND r.target = 'motorista';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_driver_rating(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_driver_rating(uuid) TO authenticated;

-- 7. Fim da inserção anónima em `reviews` (decisão 2) --------------------------
-- A tabela do Bornaal fica de pé, com os seus dados e as restantes policies. O que
-- sai é só a porta por onde um anónimo escrevia na base sem sessão nenhuma.
DROP POLICY IF EXISTS "Anonymous can insert reviews" ON public.reviews;
REVOKE INSERT ON public.reviews FROM anon;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'reviews' AND 'anon' = ANY(roles) AND cmd = 'INSERT';
  IF n > 0 THEN RAISE EXCEPTION 'ainda ha % policy de INSERT anonimo em reviews', n; END IF;
END $$;
