import { describe, it, expect } from "vitest";
import {
  saldoPerante,
  comissaoPaga,
  comissaoGerada,
  aReceberDaFrota,
  aEntregarAosRestaurantes,
  aEntregarAFrota,
  aReceberDosRestaurantes,
  entradasVivas,
  comissaoDaLinha,
  type LinhaLedger,
} from "./ledger";

/**
 * O peso destes testes está nos SINAIS e nas REVERSÕES, que é onde um ledger
 * mente sem dar erro: um sinal trocado mostra "tens a receber" a quem tem a
 * pagar, e continua a somar certo.
 */

/** O exemplo de §27, tal como está no documento mestre. */
const PEDIDO_27_RESTAURANTE: LinhaLedger[] = [
  { entry_type: "comissao_restaurante", counterparty: "platform", amount: 500, base_amount: 10000, rate: 5 },
  { entry_type: "credito_comida", counterparty: "fleet", amount: -10000, base_amount: 10000 },
];

const PEDIDO_27_FROTA: LinhaLedger[] = [
  { entry_type: "comissao_frota", counterparty: "platform", amount: 50, base_amount: 1000, rate: 5 },
  { entry_type: "divida_comida", counterparty: "business", amount: 10000, base_amount: 10000 },
];

describe("ledger — o exemplo de §27", () => {
  it("o restaurante deve 500 de comissao a plataforma", () => {
    expect(saldoPerante(PEDIDO_27_RESTAURANTE, "platform")).toBe(500);
  });

  it("a frota deve 50 de comissao a plataforma", () => {
    expect(saldoPerante(PEDIDO_27_FROTA, "platform")).toBe(50);
  });

  it("a plataforma acumula 550 no total", () => {
    expect(
      saldoPerante(PEDIDO_27_RESTAURANTE, "platform") +
        saldoPerante(PEDIDO_27_FROTA, "platform"),
    ).toBe(550);
  });
});

describe("ledger — §28, a direccao do dinheiro na entrega", () => {
  // Esta e a asserção que protege a decisao de 2026-09-10. Se alguem inverter
  // o sinal, os dois testes seguintes falham em direccoes opostas, e fica
  // obvio qual dos lados ficou errado.
  it("o restaurante TEM A RECEBER da frota (positivo)", () => {
    expect(aReceberDaFrota(PEDIDO_27_RESTAURANTE)).toBe(10000);
  });

  it("a frota TEM A ENTREGAR ao restaurante (positivo)", () => {
    expect(aEntregarAosRestaurantes(PEDIDO_27_FROTA)).toBe(10000);
  });

  it("os dois lados sao o mesmo dinheiro, de sinais opostos", () => {
    expect(saldoPerante(PEDIDO_27_RESTAURANTE, "fleet")).toBe(
      -saldoPerante(PEDIDO_27_FROTA, "business"),
    );
  });

  it("pagamento online nao gera divida de comida nenhuma", () => {
    const online: LinhaLedger[] = [
      { entry_type: "comissao_restaurante", counterparty: "platform", amount: 500, base_amount: 10000, rate: 5 },
    ];
    expect(aReceberDaFrota(online)).toBe(0);
  });
});

describe("ledger — pagamentos", () => {
  it("um pagamento validado baixa a divida, nao a apaga", () => {
    const linhas: LinhaLedger[] = [
      ...PEDIDO_27_RESTAURANTE,
      { entry_type: "pagamento_comissao", counterparty: "platform", amount: -200, base_amount: 200 },
    ];
    expect(comissaoGerada(linhas)).toBe(500);
    expect(comissaoPaga(linhas)).toBe(200);
    expect(saldoPerante(linhas, "platform")).toBe(300);
  });

  it("pagar tudo deixa o saldo a zero, e as linhas continuam la", () => {
    const linhas: LinhaLedger[] = [
      ...PEDIDO_27_RESTAURANTE,
      { entry_type: "pagamento_comissao", counterparty: "platform", amount: -500, base_amount: 500 },
    ];
    expect(saldoPerante(linhas, "platform")).toBe(0);
    expect(linhas).toHaveLength(3);
  });

  it("pagar a mais deixa saldo negativo -- credito, nao divida", () => {
    const linhas: LinhaLedger[] = [
      ...PEDIDO_27_RESTAURANTE,
      { entry_type: "pagamento_comissao", counterparty: "platform", amount: -800, base_amount: 800 },
    ];
    expect(saldoPerante(linhas, "platform")).toBe(-300);
  });
});

describe("ledger — reversoes (§56)", () => {
  it("uma reversao anula a original sem a remover", () => {
    const linhas: LinhaLedger[] = [
      { entry_type: "comissao_restaurante", counterparty: "platform", amount: 500, base_amount: 10000, rate: 5 },
      { entry_type: "reversao", counterparty: "platform", amount: -500, base_amount: 10000, rate: 5, reverses_id: "x" },
    ];
    expect(saldoPerante(linhas, "platform")).toBe(0);
    // A original continua no extracto: e isso que §84 exige para se poder
    // explicar o que aconteceu.
    expect(linhas.filter((l) => l.entry_type !== "reversao")).toHaveLength(1);
  });

  it("reverter as duas pontas de §28 zera os dois lados", () => {
    // As originais vao marcadas `revertida`, que e como o extracto do
    // servidor as entrega (§84: aparecem, mas nao contam).
    const frota: LinhaLedger[] = [
      ...PEDIDO_27_FROTA.map((l) => ({ ...l, revertida: true })),
      { entry_type: "reversao", counterparty: "platform", amount: -50, reverses_id: "a" },
      { entry_type: "reversao", counterparty: "business", amount: -10000, reverses_id: "b" },
    ];
    expect(saldoPerante(frota, "platform")).toBe(0);
    expect(aEntregarAosRestaurantes(frota)).toBe(0);
  });
});

describe("ledger — a taxa vem da linha, nao do presente (§84)", () => {
  it("duas linhas com taxas diferentes mantem cada uma a sua", () => {
    // O cenario que justifica a fase inteira: a plataforma mudou a comissao de
    // 5% para 6% a meio. O pedido antigo continua a 5%.
    const linhas: LinhaLedger[] = [
      { entry_type: "comissao_restaurante", counterparty: "platform", amount: comissaoDaLinha(10000, 5), base_amount: 10000, rate: 5 },
      { entry_type: "comissao_restaurante", counterparty: "platform", amount: comissaoDaLinha(10000, 6), base_amount: 10000, rate: 6 },
    ];
    expect(linhas[0].amount).toBe(500);
    expect(linhas[1].amount).toBe(600);
    expect(saldoPerante(linhas, "platform")).toBe(1100);
  });

  it("arredonda ao franco, como §27", () => {
    expect(comissaoDaLinha(10000, 5)).toBe(500);
    expect(comissaoDaLinha(1000, 5)).toBe(50);
    // 2.500 x 5% = 125 exacto; 2.550 x 5% = 127,5 -> 128
    expect(comissaoDaLinha(2500, 5)).toBe(125);
    expect(comissaoDaLinha(2550, 5)).toBe(128);
  });
});

describe("ledger — conta vazia", () => {
  it("sem movimentos, tudo a zero e nada rebenta", () => {
    expect(saldoPerante([], "platform")).toBe(0);
    expect(comissaoPaga([])).toBe(0);
    expect(comissaoGerada([])).toBe(0);
    expect(aReceberDaFrota([])).toBe(0);
    expect(aEntregarAosRestaurantes([])).toBe(0);
  });
});

/**
 * FASE 6.1 — pagamento online (decisão de 2026-09-15).
 *
 * O espelho do §28: aqui é o restaurante que recebe tudo do cliente, pelo
 * merchant_code dele, e fica a dever a taxa de entrega à frota. O erro que
 * estes testes apanham é somar isto com a dívida da comida só porque ambas têm
 * a mesma contraparte — dá um número que não quer dizer nada.
 */
const ONLINE_RESTAURANTE: LinhaLedger[] = [
  { entry_type: "comissao_restaurante", counterparty: "platform", amount: 500, base_amount: 10000, rate: 5 },
  { entry_type: "divida_entrega", counterparty: "fleet", amount: 1000, base_amount: 1000 },
];

const ONLINE_FROTA: LinhaLedger[] = [
  { entry_type: "comissao_frota", counterparty: "platform", amount: 50, base_amount: 1000, rate: 5 },
  { entry_type: "credito_entrega", counterparty: "business", amount: -1000, base_amount: 1000 },
];

describe("ledger — pagamento online, o espelho do §28", () => {
  it("o restaurante tem a ENTREGAR a taxa de entrega a frota", () => {
    expect(aEntregarAFrota(ONLINE_RESTAURANTE)).toBe(1000);
  });

  it("a frota tem a RECEBER essa taxa do restaurante", () => {
    expect(aReceberDosRestaurantes(ONLINE_FROTA)).toBe(1000);
  });

  it("num pedido online o restaurante nao tem comida nenhuma a receber", () => {
    // O contrario do §28: aqui nao passou dinheiro pelo motorista.
    expect(aReceberDaFrota(ONLINE_RESTAURANTE)).toBe(0);
    expect(aEntregarAosRestaurantes(ONLINE_FROTA)).toBe(0);
  });

  it("as duas direccoes nao se misturam na mesma conta", () => {
    // Um restaurante com um pedido a dinheiro E um online: tem 10.000 a
    // receber da frota e 1.000 a entregar-lhe. Somar por contraparte dava
    // 9.000, que nao e' nenhuma das duas coisas e nao se paga a ninguem.
    const misto = [...PEDIDO_27_RESTAURANTE, ...ONLINE_RESTAURANTE];
    expect(aReceberDaFrota(misto)).toBe(10000);
    expect(aEntregarAFrota(misto)).toBe(1000);
    expect(saldoPerante(misto, "fleet")).toBe(-9000); // o numero enganador
  });
});

describe("ledger — reversoes saem dos totais mas ficam no historico (§56)", () => {
  // O defeito da Fase 6.0: um pedido `online` cancelado continuava a contar
  // como venda, porque a reversao da comissao tem amount < 0 e o teste que
  // descontava a base so' olhava para amount > 0.
  const CANCELADO: LinhaLedger[] = [
    { entry_type: "comissao_restaurante", counterparty: "platform", amount: 500, base_amount: 10000, rate: 5, revertida: true },
    { entry_type: "reversao", counterparty: "platform", amount: -500, base_amount: 10000, rate: 5, reverses_id: "a" },
  ];

  it("a comissao revertida deixa de contar", () => {
    expect(comissaoGerada(CANCELADO)).toBe(0);
  });

  it("mas as duas linhas continuam la, para o extracto", () => {
    expect(CANCELADO).toHaveLength(2);
    expect(entradasVivas(CANCELADO)).toHaveLength(0);
  });

  it("uma reconclusao abre linhas novas que voltam a contar (ciclo 2)", () => {
    const reconcluido: LinhaLedger[] = [
      ...CANCELADO,
      { entry_type: "comissao_restaurante", counterparty: "platform", amount: 500, base_amount: 10000, rate: 5 },
    ];
    expect(entradasVivas(reconcluido)).toHaveLength(1);
    expect(comissaoGerada(reconcluido)).toBe(500); // 500, nao 1000
  });

  it("a divida da comida revertida nao fica a ser cobrada", () => {
    const frota: LinhaLedger[] = [
      { entry_type: "divida_comida", counterparty: "business", amount: 10000, base_amount: 10000, revertida: true },
      { entry_type: "reversao", counterparty: "business", amount: -10000, base_amount: 10000, reverses_id: "b" },
    ];
    expect(aEntregarAosRestaurantes(frota)).toBe(0);
  });
});
