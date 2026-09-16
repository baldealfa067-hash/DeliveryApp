-- FASE 2.5 -- horarios de funcionamento.
--
-- O PROBLEMA: nada no sistema sabe se um restaurante esta aberto. O cliente faz
-- o pedido as 3 da manha, o pedido fica em `novo` ate alguem acordar, e o
-- cliente fica a olhar para um ecra que lhe prometeu comida (§52, §83).
--
-- DECISOES QUE TOMEI (nao vieram do dono; ficam registadas no CLAUDE.md para
-- serem confirmadas ou trocadas):
--
--   a) SEM HORARIO DEFINIDO = SEMPRE ABERTO. E o unico default seguro: ha
--      restaurantes reais em producao que nunca vao abrir este ecra, e um
--      default de "fechado" fechava-os a todos no momento em que a migracao
--      corresse. Um restaurante so passa a ser fechavel depois de dizer quando
--      abre.
--   b) O HORARIO TRAVA O PEDIDO, nao e so decoracao. §46 poe a regra no
--      backend; mostrar "Fechado" e aceitar o pedido a seguir era mentir ao
--      cliente e ao restaurante ao mesmo tempo.
--   c) HA UM INTERRUPTOR MANUAL (`accepting_orders`) que fecha JA, independente
--      do horario. E o caso real de Bissau: acabou o peixe, acabou o gas, houve
--      um problema. Sem isto o dono tinha de ir editar o horario para fechar
--      uma hora, e depois lembrar-se de o repor.
--   d) O PEDIDO MANUAL NAO E TRAVADO. Quem o lanca e o proprio restaurante, que
--      obviamente sabe se esta aberto. Travar o dono a entrada da sua propria
--      loja era absurdo.
--
-- FUSO: a Guine-Bissau e UTC+0. Guarda-se e compara-se em UTC sem conversao
-- nenhuma. Fica escrito para ninguem "corrigir" isto mais tarde com um
-- AT TIME ZONE que introduzia um desvio.

-- ---------------------------------------------------------------------------
-- 1. O interruptor manual
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS accepting_orders boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.profiles.accepting_orders IS
  'Interruptor manual do dono (Fase 2.5). false = fechado JA, seja qual for o '
  'horario. Independente de `business_hours`: um fecha por excepcao, o outro '
  'por rotina. Nada automatico lhe toca -- repor e do dono, como em '
  'menu_items.is_available.';

-- ---------------------------------------------------------------------------
-- 2. O horario
-- ---------------------------------------------------------------------------
-- VARIAS LINHAS POR DIA de proposito: o almoco e o jantar sao dois periodos, e
-- muitos sitios fecham a tarde. Um par unico opens/closes por dia obrigava a
-- fingir que se esta aberto entre os dois.
CREATE TABLE IF NOT EXISTS public.business_hours (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- 0 = domingo ... 6 = sabado, igual ao EXTRACT(DOW), para nao haver conversao
  -- a fazer na comparacao -- e conversoes de indice de dia da semana sao um
  -- classico de erro por um.
  weekday     smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  opens_at    time NOT NULL,
  closes_at   time NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- O mesmo periodo duas vezes no mesmo dia nao existe.
CREATE UNIQUE INDEX IF NOT EXISTS business_hours_sem_repetir
  ON public.business_hours (business_id, weekday, opens_at);

CREATE INDEX IF NOT EXISTS business_hours_por_negocio
  ON public.business_hours (business_id, weekday);

COMMENT ON TABLE public.business_hours IS
  'Horario de funcionamento por dia da semana (Fase 2.5). Varias linhas por dia '
  'para permitir periodos partidos (almoco/jantar). `closes_at <= opens_at` '
  'significa que o periodo atravessa a meia-noite e conta no dia em que ABRE. '
  'Sem linhas nenhumas = sempre aberto.';

ALTER TABLE public.business_hours ENABLE ROW LEVEL SECURITY;

-- Leitura publica: e a montra. O cliente tem de poder ver se esta aberto ANTES
-- de ter conta, tal como ve o menu.
DROP POLICY IF EXISTS "Horarios visiveis a todos" ON public.business_hours;
CREATE POLICY "Horarios visiveis a todos"
ON public.business_hours FOR SELECT TO anon, authenticated
USING (true);

GRANT SELECT ON public.business_hours TO anon, authenticated;
-- Escrita so pela RPC: o horario inteiro e substituido de uma vez, e deixar
-- INSERT/DELETE soltos permitia estados intermedios incoerentes.
REVOKE INSERT, UPDATE, DELETE ON public.business_hours FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Esta aberto?
-- ---------------------------------------------------------------------------
-- UMA definicao, usada pelo ecra da loja, pelo travao do pedido e pela lista.
-- Se cada um decidisse por sua conta, a loja dizia "Aberto" e o checkout
-- recusava -- que e exactamente o tipo de surpresa que o §83 proibe.
CREATE OR REPLACE FUNCTION public.is_business_open(
  p_business_id uuid,
  p_at          timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_aceita  boolean;
  v_existe  boolean;
  v_tem_hor boolean;
  v_dow     smallint;
  v_hora    time;
BEGIN
  SELECT true, COALESCE(p.accepting_orders, true)
  INTO v_existe, v_aceita
  FROM public.profiles p WHERE p.id = p_business_id;

  IF NOT COALESCE(v_existe, false) THEN RETURN false; END IF;
  -- O interruptor manual ganha sempre: fechou, fechou.
  IF NOT v_aceita THEN RETURN false; END IF;

  SELECT EXISTS (SELECT 1 FROM public.business_hours h WHERE h.business_id = p_business_id)
  INTO v_tem_hor;
  -- Decisao (a): quem nunca definiu horario esta sempre aberto.
  IF NOT v_tem_hor THEN RETURN true; END IF;

  v_dow  := EXTRACT(DOW FROM p_at)::smallint;
  v_hora := p_at::time;

  RETURN EXISTS (
    SELECT 1 FROM public.business_hours h
    WHERE h.business_id = p_business_id
      AND (
        -- Periodo normal, dentro do mesmo dia.
        (h.closes_at > h.opens_at
          AND h.weekday = v_dow
          AND v_hora >= h.opens_at AND v_hora < h.closes_at)
        OR
        -- Periodo que atravessa a meia-noite (ex: 19:00 -> 02:00). Conta no dia
        -- em que ABRE, portanto as 01:00 de sabado quem manda e a linha de
        -- sexta. `(v_dow + 6) % 7` e o dia anterior sem numeros negativos.
        (h.closes_at <= h.opens_at
          AND (
               (h.weekday = v_dow AND v_hora >= h.opens_at)
            OR (h.weekday = (v_dow + 6) % 7 AND v_hora < h.closes_at)
          ))
      )
  );
END;
$$;

COMMENT ON FUNCTION public.is_business_open(uuid, timestamptz) IS
  'Fonte unica de "esta aberto" (Fase 2.5): interruptor manual, depois horario. '
  'Sem horario definido devolve true. Periodos que atravessam a meia-noite '
  'contam no dia em que abrem. UTC sem conversao -- a Guine-Bissau e UTC+0.';

REVOKE EXECUTE ON FUNCTION public.is_business_open(uuid, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_business_open(uuid, timestamptz) TO anon, authenticated;
