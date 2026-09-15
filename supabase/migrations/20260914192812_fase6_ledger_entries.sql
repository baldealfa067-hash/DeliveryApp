-- Versao 20260914192812 = hora real da aplicacao (apply_migration).

-- FASE 6 (Financeiro) -- o ledger (§30, §53, §56, §84).
--
-- O QUE SUBSTITUI: `get_business_commission` e `get_all_commissions` somavam
-- `orders.total` em tempo real e multiplicavam pela taxa ACTUAL de
-- `platform_settings`. Mudar a comissao de 5% para 6% reescrevia
-- retroactivamente toda a divida historica de todos os parceiros, em silencio.
-- E o `BusinessCurrentAccount.tsx` fazia a mesma conta uma TERCEIRA vez, no
-- browser (§46). Nenhum dos tres conseguia responder a' pergunta de §84 --
-- "deves X porque estas foram as transaccoes".
--
-- PARTIDA DOBRADA, e nao uma linha por facto. Cada evento economico escreve uma
-- linha POR CONTA AFECTADA. A divida da comida de §28 tem dois lados -- a frota
-- deve, o restaurante tem a receber -- e escrever so' um deles obrigava cada
-- ecra a inverter o sinal por sua conta, que e' como os sinais acabam trocados.
-- Assim cada painel pergunta apenas "o que ha' na MINHA conta".
--
--   amount > 0  esta conta DEVE a' contraparte
--   amount < 0  esta conta TEM A RECEBER da contraparte
--
-- Saldo = SUM(amount) filtrado por conta e contraparte. Nunca um campo editavel
-- (§30: "nunca simplesmente alterar um numero de saldo").
--
-- `base_amount` e `rate` FICAM CONGELADOS NA LINHA. E' isto, e so' isto, que
-- impede o recalculo ao voo: a entrada guarda sobre que valor incidiu e a que
-- taxa, no momento em que aconteceu. Mudar a taxa amanha nao toca em nada do
-- que ja' esta' escrito.
--
-- IMUTABILIDADE POR TRIGGER, nao so' por ausencia de GRANT. §56 diz para nunca
-- apagar silenciosamente uma transaccao financeira. Permissoes ja' falharam tres
-- vezes nesta base -- 20260909213622, 20260910033308 e 20260910035702, as tres
-- em que um REVOKE correu sem erro e nao fez nada. Um trigger nao tem essa
-- classe de falha: ou esta' la', ou nao esta'.
--
-- CORRIGIR e' escrever uma linha nova com `reverses_id` a apontar para a
-- original. A original fica onde estava (§56).

CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  entry_type    text NOT NULL,
  -- De quem e' esta linha.
  account_kind  text NOT NULL,
  -- A quem deve (ou de quem tem a receber).
  counterparty  text NOT NULL,

  -- RESTRICT e nao CASCADE, de proposito: com uma entrada financeira em cima, o
  -- pedido deixa de poder ser apagado. E' o §56 imposto pelo esquema em vez de
  -- confiado a' disciplina de quem escreve o DELETE.
  business_id   uuid REFERENCES public.profiles(id)   ON DELETE RESTRICT,
  fleet_id      uuid REFERENCES public.fleets(id)     ON DELETE RESTRICT,
  order_id      uuid REFERENCES public.orders(id)     ON DELETE RESTRICT,
  delivery_id   uuid REFERENCES public.deliveries(id) ON DELETE RESTRICT,
  -- O motorista e' informativo (§28 quer saber quem transportou), nao e' a
  -- conta. Pode sair da frota sem que a divida dela desapareca.
  driver_id     uuid REFERENCES public.drivers(id)    ON DELETE SET NULL,
  payment_id    uuid REFERENCES public.commission_payments(id) ON DELETE RESTRICT,

  amount        numeric NOT NULL,
  base_amount   numeric,
  rate          numeric,

  reverses_id   uuid REFERENCES public.ledger_entries(id) ON DELETE RESTRICT,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid
);

ALTER TABLE public.ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_entry_type_check;
ALTER TABLE public.ledger_entries ADD CONSTRAINT ledger_entries_entry_type_check
  CHECK (entry_type IN (
    'comissao_restaurante',  -- restaurante deve a' plataforma (§25)
    'comissao_frota',        -- frota deve a' plataforma (§26)
    'divida_comida',         -- frota deve ao restaurante (§28)
    'credito_comida',        -- o outro lado da mesma: restaurante tem a receber
    'pagamento_comissao',    -- parceiro pagou, a divida desce (§54)
    'reversao'               -- correccao (§56)
  ));

ALTER TABLE public.ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_account_kind_check;
ALTER TABLE public.ledger_entries ADD CONSTRAINT ledger_entries_account_kind_check
  CHECK (account_kind IN ('business', 'fleet', 'platform'));

ALTER TABLE public.ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_counterparty_check;
ALTER TABLE public.ledger_entries ADD CONSTRAINT ledger_entries_counterparty_check
  CHECK (counterparty IN ('business', 'fleet', 'platform'));

-- Uma conta tem de estar identificada, e tem de ser a que `account_kind` diz.
-- Sem isto era possivel escrever uma linha de frota sem frota nenhuma, e o
-- saldo desaparecia sem erro.
ALTER TABLE public.ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_conta_coerente;
ALTER TABLE public.ledger_entries ADD CONSTRAINT ledger_entries_conta_coerente
  CHECK (
    (account_kind = 'business' AND business_id IS NOT NULL) OR
    (account_kind = 'fleet'    AND fleet_id    IS NOT NULL) OR
    (account_kind = 'platform')
  );

-- §73: uma comissao por pedido e por tipo, e mais nenhuma. E' isto que torna a
-- escrita idempotente perante refresh, retry ou push duplicado. As reversoes
-- ficam de fora do indice -- por definicao repetem o par (tipo, pedido).
CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_uma_por_pedido_e_tipo
  ON public.ledger_entries (entry_type, order_id)
  WHERE order_id IS NOT NULL AND reverses_id IS NULL;

CREATE INDEX IF NOT EXISTS ledger_entries_conta_business ON public.ledger_entries (business_id, counterparty) WHERE business_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ledger_entries_conta_fleet    ON public.ledger_entries (fleet_id, counterparty)    WHERE fleet_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ledger_entries_order          ON public.ledger_entries (order_id);

COMMENT ON TABLE public.ledger_entries IS
  'Ledger financeiro append-only (§30). Uma linha por conta afectada, em partida '
  'dobrada: amount > 0 esta conta DEVE a contraparte, amount < 0 TEM A RECEBER. '
  'base_amount e rate ficam congelados na linha -- e o que impede que mudar a '
  'comissao reescreva a divida historica (§84). UPDATE e DELETE sao rejeitados '
  'por trigger: corrigir e escrever uma linha nova com reverses_id (§56).';

COMMENT ON COLUMN public.ledger_entries.rate IS
  'A taxa de comissao aplicada NAQUELE momento. Nao se le de platform_settings '
  'ao mostrar -- se lesse, mudar a taxa reescrevia o passado.';

-- ---------------------------------------------------------------------------
-- Imutabilidade
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_ledger_imutavel()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'ledger_entries e append-only (§56): % nao e permitido. Para corrigir, escreva uma entrada nova com reverses_id a apontar para a original.',
    TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS ledger_entries_sem_update ON public.ledger_entries;
CREATE TRIGGER ledger_entries_sem_update
  BEFORE UPDATE ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.tg_ledger_imutavel();

DROP TRIGGER IF EXISTS ledger_entries_sem_delete ON public.ledger_entries;
CREATE TRIGGER ledger_entries_sem_delete
  BEFORE DELETE ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.tg_ledger_imutavel();

-- ---------------------------------------------------------------------------
-- RLS -- leitura da propria conta; escrita por ninguem
-- ---------------------------------------------------------------------------
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;

-- A frota LE' a sua propria conta directamente, ao contrario de `deliveries`.
-- Sao coisas diferentes: `deliveries` fica fechada porque a policy dela nao
-- contempla o dono da frota e abri-la expunha a tabela inteira a mais um papel
-- (decisao de 2026-09-10). Aqui a linha JA' E' da frota -- `fleet_id` e' a
-- conta, nao um detalhe da entrega -- e §84 exige que ela consiga ver as
-- transaccoes que geraram a divida dela. O painel continua a usar RPC para o
-- resumo; esta policy e' o que torna o extracto possivel.
DROP POLICY IF EXISTS "Ledger visivel ao dono da conta" ON public.ledger_entries;
CREATE POLICY "Ledger visivel ao dono da conta"
ON public.ledger_entries FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR (business_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = ledger_entries.business_id AND p.user_id = auth.uid()))
  OR (fleet_id IS NOT NULL AND public.owns_fleet(ledger_entries.fleet_id))
);

-- Sem policy de INSERT/UPDATE/DELETE para ninguem: so' as funcoes
-- SECURITY DEFINER escrevem aqui, e os triggers acima recusam o resto.
GRANT SELECT ON public.ledger_entries TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.ledger_entries FROM anon, authenticated;
