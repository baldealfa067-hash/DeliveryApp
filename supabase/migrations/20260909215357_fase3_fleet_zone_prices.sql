-- FASE 3 (Frotas) -- precos de entrega por bairro/zona (§13, §14, §15).
--
-- §15: na V1 o preco NAO vem da distancia. Vem do bairro. E' deliberado -- os
-- enderecos de Bissau nao sao padronizados o suficiente para depender de mapas.
-- `deliveries.distance_km` continua a ser gravado como DADO analitico (§40 e a
-- futura evolucao para preco por km), mas nunca determina o que se cobra.
-- Sao duas coisas distintas: uma e' analitica, a outra e' o preco real.
--
-- Os bairros sao texto livre, alinhados com a lista canonica de
-- src/lib/locations.ts (11 bairros de Bissau). Nao se cria uma tabela de zonas
-- com chave estrangeira: §6 -- implementar so' o necessario. Se um dia as zonas
-- ganharem atributos proprios (poligonos, agrupamentos), promove-se entao.

CREATE TABLE IF NOT EXISTS public.fleet_zone_prices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_id    uuid NOT NULL REFERENCES public.fleets(id) ON DELETE CASCADE,
  bairro      text NOT NULL,
  preco       numeric(12,2) NOT NULL CHECK (preco >= 0),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fleet_id, bairro)
);

CREATE INDEX IF NOT EXISTS fleet_zone_prices_lookup_idx
  ON public.fleet_zone_prices(bairro, is_active) WHERE is_active;

ALTER TABLE public.fleet_zone_prices ENABLE ROW LEVEL SECURITY;

-- §46: a tabela e' privada a' frota. O preco de uma frota e' informacao
-- competitiva -- a Frota B nao lhe poe os olhos em cima. O CLIENTE tambem nao
-- le esta tabela: ve' o preco aplicavel atraves de get_delivery_price(), que so'
-- devolve o valor final, nunca a grelha de precos de ninguem.
DROP POLICY IF EXISTS "Fleet owner reads own prices" ON public.fleet_zone_prices;
CREATE POLICY "Fleet owner reads own prices"
ON public.fleet_zone_prices FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.fleets f
          WHERE f.id = fleet_zone_prices.fleet_id AND f.owner_user_id = auth.uid())
  OR public.has_role(auth.uid(), 'admin')
);

DROP POLICY IF EXISTS "Fleet owner writes own prices" ON public.fleet_zone_prices;
CREATE POLICY "Fleet owner writes own prices"
ON public.fleet_zone_prices FOR ALL TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.fleets f
          WHERE f.id = fleet_zone_prices.fleet_id AND f.owner_user_id = auth.uid())
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.fleets f
          WHERE f.id = fleet_zone_prices.fleet_id AND f.owner_user_id = auth.uid())
);

REVOKE ALL ON public.fleet_zone_prices FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fleet_zone_prices TO authenticated;
GRANT ALL ON public.fleet_zone_prices TO service_role;
