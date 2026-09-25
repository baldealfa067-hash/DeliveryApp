-- order_ratings deixa de ser legível por qualquer pessoa (2026-09-25, aprovado
-- pelo dono).
--
-- A Fase 9.4 abriu a tabela com `USING (true)` para anon e authenticated, porque
-- a página do restaurante é a montra e lia a lista directamente. Mas a tabela
-- inteira ia junto: `driver_id`, `customer_id`, `customer_name` e `order_id`,
-- a qualquer pessoa sem conta. Com isso:
--   - qualquer um calculava a média de cada motorista, que a própria 9.4 tinha
--     decidido NÃO ser pública (get_driver_rating só abre ao próprio, à frota e
--     ao admin -- e a tabela aberta tornava essa RPC decorativa);
--   - o nome de um cliente ficava publicamente ligado a um pedido concreto.
--
-- Quem lê as LINHAS a partir de agora:
--   - o cliente que escreveu a avaliação;
--   - o dono do restaurante avaliado (só as de alvo 'restaurante', que são as
--     únicas com business_id -- ver o CHECK order_ratings_alvo_coerente);
--   - o admin.
-- O motorista NÃO lê linhas: vê só a sua média agregada, por get_driver_rating.
--
-- A montra pública continua, mas pela RPC get_business_reviews, que devolve só
-- estrelas, comentário e data. Sem nome e sem ids -- decisão do dono.

-- 1. Leitura directa ------------------------------------------------------------
DROP POLICY IF EXISTS "Avaliacoes sao publicas" ON public.order_ratings;

-- O anónimo perde a tabela por inteiro, não só as linhas: não há nenhuma linha
-- que ele deva ler directamente.
REVOKE SELECT ON public.order_ratings FROM anon;

DROP POLICY IF EXISTS "Avaliacoes: autor, restaurante avaliado e admin" ON public.order_ratings;
CREATE POLICY "Avaliacoes: autor, restaurante avaliado e admin" ON public.order_ratings
  FOR SELECT TO authenticated
  USING (
    customer_id = auth.uid()
    OR (
      target = 'restaurante'
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = order_ratings.business_id AND p.user_id = auth.uid()
      )
    )
    OR public.has_role(auth.uid(), 'admin')
  );

-- 2. Montra pública do restaurante ---------------------------------------------
CREATE OR REPLACE FUNCTION public.get_business_reviews(p_business_id uuid)
RETURNS TABLE (rating smallint, comment text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT r.rating, r.comment, r.created_at
  FROM public.order_ratings r
  WHERE r.business_id = p_business_id AND r.target = 'restaurante'
  ORDER BY r.created_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_business_reviews(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_business_reviews(uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.get_business_reviews(uuid) IS
  'Montra publica das avaliacoes de um restaurante: so estrelas, comentario e data. '
  'Sem nome do cliente e sem ids, de proposito (2026-09-25). A tabela order_ratings '
  'ja nao e legivel pelo anonimo -- nao reabrir com uma policy.';

-- 3. Asserções: rebentam se alguém reabrir a tabela ----------------------------
DO $$
DECLARE n int;
BEGIN
  IF has_table_privilege('anon', 'public.order_ratings', 'SELECT') THEN
    RAISE EXCEPTION 'anon ainda tem SELECT em order_ratings';
  END IF;
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'order_ratings'
     AND cmd = 'SELECT' AND qual = 'true';
  IF n > 0 THEN RAISE EXCEPTION 'ainda ha % policy SELECT USING (true) em order_ratings', n; END IF;
END $$;
