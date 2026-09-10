-- FASE 3 (Frotas) -- congelar frota e taxa de entrega no momento do pedido.
--
-- §14/§83: "o cliente deve sempre saber o preco da entrega antes de confirmar".
-- Isso obriga a resolver a frota e o preco no CHECKOUT, nao mais tarde. Se a
-- frota so' fosse escolhida quando o restaurante marca "pronto", o preco
-- mostrado ao cliente podia nao ser o cobrado -- uma frota podia ter mudado a
-- grelha entretanto. Congela-se no pedido; a entrega herda.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS fleet_id     uuid REFERENCES public.fleets(id),
  ADD COLUMN IF NOT EXISTS delivery_fee numeric(12,2);

ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS fleet_id uuid REFERENCES public.fleets(id);

CREATE INDEX IF NOT EXISTS orders_fleet_id_idx     ON public.orders(fleet_id);
CREATE INDEX IF NOT EXISTS deliveries_fleet_id_idx ON public.deliveries(fleet_id);

COMMENT ON COLUMN public.orders.delivery_fee IS
  'Taxa de entrega cobrada, congelada no checkout a partir de fleet_zone_prices. Nunca derivada de distance_km (§15).';
COMMENT ON COLUMN public.deliveries.distance_km IS
  'Dado analitico (§40). NAO determina o preco na V1 -- o preco vem do bairro (§15).';

-- ---------------------------------------------------------------------------
-- Resolucao do preco: qual frota serve este bairro, e por quanto.
--
-- REGRA DE SELECCAO: entre as frotas activas com preco activo para o bairro,
-- ganha a MAIS BARATA; empate desfeito pela frota mais antiga. E' determinista
-- e explicavel ao cliente (§83), e da'-lhe o melhor preco disponivel.
--
-- >>> ESTA REGRA E' UMA ESCOLHA DE PRODUTO, NAO UMA IMPOSICAO DO DOCUMENTO. <<<
-- §14 fala de "a frota" no singular e nao diz como escolher quando ha varias.
-- Fica sinalizada para decisao: alternativas plausiveis sao rotacao entre
-- frotas, frota preferencial por restaurante, ou a que tiver mais motoristas
-- disponiveis. Mudar a regra e' mudar esta funcao, e mais nada.
--
-- A grelha de precos de cada frota continua privada: isto devolve um valor
-- final, nunca a tabela de ninguem.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_delivery_price(p_bairro text)
RETURNS TABLE (fleet_id uuid, fleet_name text, preco numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT f.id, f.name, z.preco
  FROM public.fleet_zone_prices z
  JOIN public.fleets f ON f.id = z.fleet_id
  WHERE z.is_active
    AND f.is_active
    AND lower(btrim(z.bairro)) = lower(btrim(p_bairro))
  ORDER BY z.preco ASC, f.created_at ASC
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_delivery_price(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_delivery_price(text) TO authenticated;
