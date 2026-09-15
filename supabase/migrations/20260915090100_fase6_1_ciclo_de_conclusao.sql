-- FASE 6.1 -- reconcluir um pedido volta a escrever no ledger (§56, §73).
--
-- O DEFEITO. O admin e' a valvula de correccao do §36 e pode fazer qualquer
-- transicao, incluindo `concluido -> cancelado -> concluido`. No cancelamento
-- o trigger escreve reversoes. Na segunda conclusao, o
-- `ON CONFLICT (entry_type, order_id) DO NOTHING` via as linhas ORIGINAIS
-- ainda la' (uma reversao nao apaga nada, §56) e nao escrevia nada.
-- Resultado: pedido concluido, ledger a zero, comissao perdida em silencio.
--
-- A SOLUCAO, e porque nao foi apagar a original. Apagar resolvia o conflito e
-- violava o §56. O que falta nao e' espaco na tabela -- e' saber QUE VOLTA de
-- conclusao cada linha e'. Por isso: `ciclo`. A chave de idempotencia passa a
-- ser (tipo, pedido, ciclo), e nao (tipo, pedido).
--
--   1a conclusao        ciclo 1
--   cancelamento        reversoes do ciclo 1 (mesmo ciclo -- ficam emparelhadas)
--   2a conclusao        ciclo 2, linhas novas
--
-- O §73 continua de pe': dentro do MESMO ciclo o indice unico continua a
-- recusar a segunda escrita, portanto refresh, retry e push duplicado nao
-- duplicam comissao nenhuma. O que passou a ser possivel e' so' uma volta
-- NOVA, e essa exige que a anterior tenha sido revertida por inteiro.

ALTER TABLE public.ledger_entries
  ADD COLUMN IF NOT EXISTS ciclo smallint NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.ledger_entries.ciclo IS
  'Que volta de conclusao esta linha e. Um pedido reconcluido depois de '
  'cancelado abre o ciclo seguinte, em vez de reescrever o anterior (§56). '
  'A chave de idempotencia do §73 e (entry_type, order_id, ciclo).';

DROP INDEX IF EXISTS public.ledger_entries_uma_por_pedido_e_tipo;
CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_uma_por_pedido_tipo_ciclo
  ON public.ledger_entries (entry_type, order_id, ciclo)
  WHERE order_id IS NOT NULL AND reverses_id IS NULL;

-- ---------------------------------------------------------------------------
-- A reversao copia o ciclo da linha que anula
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ledger_reverter_pedido(p_order_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.ledger_entries (
    entry_type, account_kind, counterparty, business_id, fleet_id, driver_id,
    order_id, delivery_id, amount, base_amount, rate, reverses_id, ciclo, note)
  SELECT 'reversao', e.account_kind, e.counterparty, e.business_id, e.fleet_id,
         e.driver_id, e.order_id, e.delivery_id, -e.amount, e.base_amount, e.rate,
         e.id, e.ciclo, p_motivo
  FROM public.ledger_entries e
  WHERE e.order_id = p_order_id
    AND e.reverses_id IS NULL
    -- so' o que ainda nao foi revertido: correr isto duas vezes nao duplica
    AND NOT EXISTS (
      SELECT 1 FROM public.ledger_entries r WHERE r.reverses_id = e.id
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ledger_reverter_pedido(uuid, text) FROM PUBLIC, anon, authenticated;

-- `ledger_registar_conclusao` -- que e' quem ATRIBUI o ciclo -- e' reescrita na
-- migracao seguinte, e nao aqui, de proposito: essa migracao acrescenta-lhe
-- tambem as linhas do pagamento online. Duas versoes seguidas do corpo de uma
-- funcao financeira no historico e' como as duas versoes acabam a divergir --
-- por isso o corpo existe num sitio so'. As duas migracoes aplicam-se juntas.
