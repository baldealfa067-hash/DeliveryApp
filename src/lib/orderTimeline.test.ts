import { describe, it, expect } from "vitest";
import { ultimoPassoAntesDeCancelar } from "./orderTimeline";

const COMIDA = ["novo", "confirmado", "em_preparacao", "pronto", "aguardando_motorista",
  "motorista_encontrado", "pedido_recolhido", "a_caminho", "concluido"];
const ENVIO = ["aguardando_motorista", "motorista_encontrado", "pedido_recolhido", "a_caminho", "concluido"];
const h = (...s: string[]) => s.map((status) => ({ status }));

describe("ultimoPassoAntesDeCancelar", () => {
  it("cancelado em novo: pára no primeiro passo", () => {
    expect(ultimoPassoAntesDeCancelar(COMIDA, h("novo", "cancelado"))).toBe(0);
  });

  it("cancelado em preparação: pára em Em preparação, não mais à frente", () => {
    expect(ultimoPassoAntesDeCancelar(COMIDA, h("novo", "confirmado", "em_preparacao", "cancelado"))).toBe(2);
  });

  it("conta o passo MAIS AVANÇADO, não a ordem das linhas do histórico", () => {
    expect(ultimoPassoAntesDeCancelar(COMIDA, h("aguardando_motorista", "pronto", "novo", "cancelado"))).toBe(4);
  });

  it("envio cancelado à espera de motorista: pára no primeiro passo do envio", () => {
    expect(ultimoPassoAntesDeCancelar(ENVIO, h("aguardando_motorista", "cancelado"))).toBe(0);
  });

  it("estados fora do fluxo (na_cozinha, legados) não empurram o corte", () => {
    expect(ultimoPassoAntesDeCancelar(COMIDA, h("novo", "na_cozinha", "cancelado"))).toBe(0);
  });

  it("sem histórico, mostra de menos em vez de inventar percurso", () => {
    expect(ultimoPassoAntesDeCancelar(COMIDA, [])).toBe(0);
  });
});
