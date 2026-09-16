-- FASE 2.3 -- Fecho de caixa diario: a divida de comida passa a poder ser paga.
--
-- O BURACO. §28 diz que no pagamento a dinheiro o cliente paga ao MOTORISTA, que
-- fica com a taxa de entrega e deve o valor da comida ao restaurante. A Fase 6
-- registou essa divida (`divida_comida` do lado da frota, `credito_comida` do
-- lado do restaurante) e parou ai: nao havia entrada nenhuma que a saldasse.
-- `pagamento_comissao` so serve a divida a PLATAFORMA (§54). Ou seja, a divida
-- entre frota e restaurante crescia todos os dias e nao tinha como descer --
-- o dinheiro mudava de maos na rua e o sistema nunca sabia.
--
-- DECISAO DO DONO DO PROJECTO (2026-09-16): liquidacao real, com confirmacao do
-- RESTAURANTE. A frota declara o que entregou; a divida so desce quando o
-- restaurante confirma que recebeu. E o mesmo padrao do §54 (envia comprovativo
-- -> alguem valida), com o restaurante no papel de validador em vez do admin --
-- porque o dinheiro e dele e a plataforma nao tem de estar no meio de cada
-- acerto diario.
--
-- PORQUE NAO BASTA A DECLARACAO DA FROTA: baixar a divida so com a palavra de
-- quem deve poe o restaurante a descobrir no extracto que "ja pagaram" sem ter
-- visto dinheiro, e a unica saida seria uma reversao (§56) depois do facto.
-- Com confirmacao, o desacordo aparece ANTES de mexer nas contas, e fica
-- registado como `contestado` em vez de virar discussao sem rasto.
--
-- ===========================================================================
-- A ARMADILHA DESTA FASE, e porque quase passou despercebida
-- ===========================================================================
-- As funcoes de leitura da Fase 6 nao somam por contraparte -- somam por
-- ENTRY_TYPE exacto:
--
--   food_receivable      = -SUM(amount) WHERE entry_type = 'credito_comida'
--   divida_restaurantes  =  SUM(amount) WHERE entry_type = 'divida_comida'
--
-- Escrever um tipo NOVO no ledger, por mais correcto que fosse o sinal, nao
-- mexia um centimo no que o painel mostra: as linhas entravam e ninguem as
-- somava. Terias uma liquidacao "a funcionar" com a divida na mesma no ecra.
-- Por isso esta migracao tambem ENSINA os dois leitores a contar os tipos
-- novos (ver 20260916031914). Medido na definicao VIVA das funcoes, nao no
-- ficheiro (a licao de 20260916014049).

-- ---------------------------------------------------------------------------
-- 1. Tipos novos de entrada
-- ---------------------------------------------------------------------------
-- Par em partida dobrada, como `divida_comida`/`credito_comida`:
--   entrega_dinheiro     frota,        amount < 0  -> a divida dela desce
--   recebimento_dinheiro restaurante,  amount > 0  -> o que tem a receber desce
ALTER TABLE public.ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_entry_type_check;
ALTER TABLE public.ledger_entries ADD CONSTRAINT ledger_entries_entry_type_check
  CHECK (entry_type IN (
    'comissao_restaurante',
    'comissao_frota',
    'divida_comida',
    'credito_comida',
    'divida_entrega',
    'credito_entrega',
    'pagamento_comissao',
    'entrega_dinheiro',
    'recebimento_dinheiro',
    'reversao'
  ));

-- ---------------------------------------------------------------------------
-- 2. O acerto em si
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cash_settlements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_id       uuid NOT NULL REFERENCES public.fleets(id)   ON DELETE RESTRICT,
  business_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  -- O DIA a que o fecho diz respeito. Separado do created_at de proposito: um
  -- acerto feito de manha pode fechar a caixa da vespera, e e o dia da
  -- operacao que interessa ao fecho, nao o instante do registo.
  -- A Guine-Bissau e UTC+0, portanto current_date basta e nao ha conversao a
  -- fazer -- fica escrito para nao se assumir o contrario mais tarde.
  dia            date NOT NULL DEFAULT current_date,
  amount         numeric NOT NULL CHECK (amount > 0),
  status         text NOT NULL DEFAULT 'declarado',
  note           text,
  contest_reason text,
  declared_by    uuid,
  declared_at    timestamptz NOT NULL DEFAULT now(),
  resolved_by    uuid,
  resolved_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cash_settlements DROP CONSTRAINT IF EXISTS cash_settlements_status_check;
ALTER TABLE public.cash_settlements ADD CONSTRAINT cash_settlements_status_check
  CHECK (status IN ('declarado', 'confirmado', 'contestado', 'cancelado'));

-- Resolvido tem de ter quem e quando; por resolver nao pode ter nenhum dos dois.
ALTER TABLE public.cash_settlements DROP CONSTRAINT IF EXISTS cash_settlements_resolucao_coerente;
ALTER TABLE public.cash_settlements ADD CONSTRAINT cash_settlements_resolucao_coerente
  CHECK (
    (status = 'declarado' AND resolved_at IS NULL) OR
    (status <> 'declarado' AND resolved_at IS NOT NULL)
  );

-- Um contestado tem de dizer porque (§84: nao se afirma sem explicar).
ALTER TABLE public.cash_settlements DROP CONSTRAINT IF EXISTS cash_settlements_contestado_explica;
ALTER TABLE public.cash_settlements ADD CONSTRAINT cash_settlements_contestado_explica
  CHECK (status <> 'contestado' OR btrim(COALESCE(contest_reason, '')) <> '');

CREATE INDEX IF NOT EXISTS cash_settlements_fleet    ON public.cash_settlements (fleet_id, dia DESC);
CREATE INDEX IF NOT EXISTS cash_settlements_business ON public.cash_settlements (business_id, dia DESC);
CREATE INDEX IF NOT EXISTS cash_settlements_abertos  ON public.cash_settlements (business_id) WHERE status = 'declarado';

COMMENT ON TABLE public.cash_settlements IS
  'Fecho de caixa (§28): a frota declara o dinheiro da comida que entregou ao '
  'restaurante, o restaurante confirma, e so entao o ledger liquida. Escrita '
  'apenas por RPC SECURITY DEFINER -- nao ha policy de INSERT/UPDATE para '
  'ninguem, nem para as partes.';

ALTER TABLE public.cash_settlements ENABLE ROW LEVEL SECURITY;

-- LEITURA DIRECTA PERMITIDA AOS DOIS LADOS, ao contrario de `deliveries`. Aqui
-- nao ha o problema de 2026-09-10: este documento e partilhado -- pertence a
-- frota E ao restaurante, e os dois precisam de o ver para poderem discordar
-- sobre ele. Usa-se `owns_fleet`/`is_business_owner`, que sao SECURITY DEFINER,
-- para nao repetir a recursao de policies da Fase 3.
DROP POLICY IF EXISTS "Acertos visiveis as duas partes" ON public.cash_settlements;
CREATE POLICY "Acertos visiveis as duas partes"
ON public.cash_settlements FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.owns_fleet(fleet_id)
  OR public.is_business_owner(business_id)
);

GRANT SELECT ON public.cash_settlements TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.cash_settlements FROM anon, authenticated;
REVOKE ALL ON public.cash_settlements FROM anon;

-- ---------------------------------------------------------------------------
-- 3. Ligacao ao ledger, e idempotencia
-- ---------------------------------------------------------------------------
ALTER TABLE public.ledger_entries
  ADD COLUMN IF NOT EXISTS settlement_id uuid REFERENCES public.cash_settlements(id) ON DELETE RESTRICT;

-- §73 aplicado aqui: o indice existente e por (entry_type, order_id) e nao
-- serve, porque um acerto nao pertence a um pedido -- fecha muitos de uma vez.
-- Este garante que confirmar duas vezes o mesmo acerto (duplo toque, retry,
-- push repetido) nao escreve a liquidacao duas vezes.
CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_uma_por_acerto_e_tipo
  ON public.ledger_entries (entry_type, settlement_id)
  WHERE settlement_id IS NOT NULL AND reverses_id IS NULL;

CREATE INDEX IF NOT EXISTS ledger_entries_settlement ON public.ledger_entries (settlement_id);

COMMENT ON COLUMN public.ledger_entries.settlement_id IS
  'O fecho de caixa que originou esta linha (Fase 2.3). Serve de chave de '
  'idempotencia: o indice unico por (entry_type, settlement_id) impede que uma '
  'confirmacao repetida liquide duas vezes.';

-- ---------------------------------------------------------------------------
-- 4. Quanto e que esta frota deve a este restaurante, agora
-- ---------------------------------------------------------------------------
-- Uma so definicao, usada pela declaracao, pela confirmacao e pelo ecra. Se
-- cada um contasse a sua maneira, o painel dizia um numero e a validacao
-- recusava por outro.
CREATE OR REPLACE FUNCTION public.divida_comida_em_aberto(
  p_fleet_id uuid, p_business_id uuid
)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(SUM(e.amount), 0)
  FROM public.ledger_entries e
  WHERE e.account_kind = 'fleet'
    AND e.fleet_id     = p_fleet_id
    AND e.business_id  = p_business_id
    AND e.entry_type IN ('divida_comida', 'entrega_dinheiro')
    AND e.reverses_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.ledger_entries r WHERE r.reverses_id = e.id);
$$;

COMMENT ON FUNCTION public.divida_comida_em_aberto(uuid, uuid) IS
  'O que a frota ainda deve a este restaurante: divida_comida menos o que ja '
  'foi entregue e confirmado. Fonte unica -- o ecra, a declaracao e a '
  'confirmacao usam esta, para nao discordarem entre si.';

REVOKE EXECUTE ON FUNCTION public.divida_comida_em_aberto(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.divida_comida_em_aberto(uuid, uuid) TO authenticated;
