/**
 * A aritmética do ledger, do lado do cliente — para MOSTRAR, nunca para decidir.
 *
 * A fonte de verdade é `ledger_entries` no servidor (§71). Estas funções só
 * agregam linhas que já vieram de lá, e existem por uma razão: antes da Fase 6
 * o painel do restaurante calculava a comissão no browser a partir da taxa
 * actual, e mudar a taxa reescrevia a dívida histórica (§84). Agora o valor já
 * vem decidido; o que falta é somá-lo sem trocar sinais.
 *
 * CONVENÇÃO DE SINAIS, que é onde isto costuma correr mal:
 *   amount > 0  esta conta DEVE à contraparte
 *   amount < 0  esta conta TEM A RECEBER da contraparte
 *
 * §28 é o caso que obriga a ter cuidado: o cliente paga ao motorista, que fica
 * com a taxa e deve a comida ao restaurante. Quem vê "tenho a receber" é o
 * restaurante; quem vê "tenho a entregar" é a frota. A direcção já foi trocada
 * uma vez por engano, e trocada mostra a cada um exactamente o oposto da
 * verdade — daí o teste dedicado.
 */

export interface LinhaLedger {
  entry_type: string;
  counterparty: "platform" | "business" | "fleet";
  amount: number;
  base_amount?: number | null;
  rate?: number | null;
  reverses_id?: string | null;
  /** Anulada por uma entrada de correcção (§56). */
  revertida?: boolean | null;
}

/**
 * Negar zero em JavaScript dá `-0`, e `-0` não é `0` para `Object.is` — que é o
 * que o `toBe` do vitest usa. Como metade destas funções inverte o sinal, uma
 * conta vazia devolvia `-0`. Não muda nada no ecrã (`(-0).toLocaleString()` dá
 * "0"), mas é falso na mesma e apanhou-se num teste. Somar zero normaliza.
 */
const semZeroNegativo = (n: number): number => n + 0;

/** Saldo perante uma contraparte. Positivo = deve; negativo = tem a receber. */
export const saldoPerante = (
  linhas: LinhaLedger[],
  contraparte: LinhaLedger["counterparty"],
): number =>
  linhas
    .filter((l) => l.counterparty === contraparte)
    .reduce((soma, l) => soma + l.amount, 0);

/**
 * O que já foi pago em comissões. As entradas de pagamento são negativas
 * (baixam a dívida); devolve-se em positivo, que é como se mostra.
 */
export const comissaoPaga = (linhas: LinhaLedger[]): number =>
  semZeroNegativo(
    -entradasVivas(linhas)
      .filter((l) => l.entry_type === "pagamento_comissao")
      .reduce((soma, l) => soma + l.amount, 0),
  );

/** Comissão gerada, antes de descontar pagamentos. */
export const comissaoGerada = (linhas: LinhaLedger[]): number =>
  entradasVivas(linhas)
    .filter((l) => l.counterparty === "platform" && l.entry_type !== "pagamento_comissao")
    .reduce((soma, l) => soma + l.amount, 0);

/**
 * Só as entradas que contam para um total: nem reversões, nem revertidas.
 *
 * A original e a reversão ficam ambas na tabela para sempre (§56) e ambas
 * aparecem no extracto — o que não podem é entrar duas vezes numa soma.
 *
 * Os três testes são precisos porque as linhas chegam em duas formas: da tabela
 * vêm com `reverses_id` preenchido na reversão, e do extracto de
 * `get_fleet_financials` vem antes `revertida` na original, com a reversão a
 * identificar-se só pelo tipo. Filtrar por um critério só deixava passar a
 * outra forma — e o que passa é uma linha contada duas vezes.
 */
export const entradasVivas = (linhas: LinhaLedger[]): LinhaLedger[] =>
  linhas.filter(
    (l) => l.entry_type !== "reversao" && !l.reverses_id && !l.revertida,
  );

/**
 * §28, perspectiva do RESTAURANTE: o que tem a receber da frota, do dinheiro
 * que o cliente pagou ao motorista.
 *
 * Filtra por TIPO e não por contraparte. Contra a frota há agora duas coisas de
 * sentidos opostos — a comida a receber (§28) e a taxa de entrega a pagar nos
 * pedidos online — e somá-las dava um número que não quer dizer nada.
 */
export const aReceberDaFrota = (linhas: LinhaLedger[]): number =>
  semZeroNegativo(
    -entradasVivas(linhas)
      .filter((l) => l.entry_type === "credito_comida")
      .reduce((soma, l) => soma + l.amount, 0),
  );

/** §28, perspectiva da FROTA: o que tem a entregar aos restaurantes. */
export const aEntregarAosRestaurantes = (linhas: LinhaLedger[]): number =>
  entradasVivas(linhas)
    .filter((l) => l.entry_type === "divida_comida")
    .reduce((soma, l) => soma + l.amount, 0);

/**
 * Pagamento online (decisão de 2026-09-15), perspectiva do RESTAURANTE: o
 * cliente pagou tudo pelo merchant_code dele, portanto a taxa de entrega ficou
 * na mão do restaurante e é da frota. Espelho do §28, papéis trocados.
 */
export const aEntregarAFrota = (linhas: LinhaLedger[]): number =>
  entradasVivas(linhas)
    .filter((l) => l.entry_type === "divida_entrega")
    .reduce((soma, l) => soma + l.amount, 0);

/** Pagamento online, perspectiva da FROTA: a taxa que tem a haver. */
export const aReceberDosRestaurantes = (linhas: LinhaLedger[]): number =>
  semZeroNegativo(
    -entradasVivas(linhas)
      .filter((l) => l.entry_type === "credito_entrega")
      .reduce((soma, l) => soma + l.amount, 0),
  );

/**
 * A comissão de uma entrada, a partir da base e da taxa GRAVADAS NA LINHA.
 * Nunca a partir da taxa actual: é essa a diferença entre um ledger e o
 * cálculo ao voo que a Fase 6 substituiu.
 */
export const comissaoDaLinha = (base: number, taxa: number): number =>
  Math.round((base * taxa) / 100);
