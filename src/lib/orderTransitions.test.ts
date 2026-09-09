import { describe, it, expect } from "vitest";
import {
  ALLOWED_TRANSITIONS,
  RESTAURANT_PANEL_STEPS,
  canTransition,
  isTerminal,
  nextStatuses,
  type OrderStatus,
  type Actor,
} from "./orderTransitions";

/**
 * Teste da disciplina de estados do §36.
 *
 * O Aditamento 2 dava esta disciplina como já implementada e coberta por um
 * teste E2E automatizado. Na auditoria da Fase 0 verificou-se que nenhuma das
 * duas coisas existia: `update_order_status` não lia sequer o estado actual do
 * pedido, e os únicos ficheiros `test-*.cjs` do repositório eram da era
 * Bornaal. Este ficheiro é a metade automatizada que faltava.
 *
 * O peso está nos casos NEGATIVOS de propósito: o caminho feliz já era o que
 * funcionava. O que nunca esteve testado é o que tem de ser recusado.
 */

const TODOS: OrderStatus[] = Object.keys(ALLOWED_TRANSITIONS) as OrderStatus[];

describe("máquina de estados do pedido — casos negativos", () => {
  it("recusa o salto de novo directamente para concluido", () => {
    expect(canTransition("novo", "concluido", "owner")).toBe(false);
  });

  it("recusa saltar a preparação: confirmado -> pronto", () => {
    expect(canTransition("confirmado", "pronto", "owner")).toBe(false);
  });

  it("recusa inventar um motorista antes de o pedido estar pronto", () => {
    expect(canTransition("em_preparacao", "motorista_encontrado", "owner")).toBe(false);
    expect(canTransition("novo", "a_caminho", "owner")).toBe(false);
  });

  it("recusa andar para trás no fluxo", () => {
    expect(canTransition("pronto", "em_preparacao", "owner")).toBe(false);
    expect(canTransition("a_caminho", "pedido_recolhido", "owner")).toBe(false);
    expect(canTransition("confirmado", "novo", "owner")).toBe(false);
  });

  it("não deixa reabrir um pedido já fechado, por nenhum actor sem ser o admin", () => {
    const naoAdmin: Actor[] = ["owner", "driver", "customer"];
    for (const actor of naoAdmin) {
      for (const destino of TODOS) {
        expect(canTransition("concluido", destino, actor)).toBe(false);
        expect(canTransition("cancelado", destino, actor)).toBe(false);
      }
    }
  });

  it("marca concluido e cancelado como terminais e mais nenhum", () => {
    for (const s of TODOS) {
      expect(isTerminal(s)).toBe(s === "concluido" || s === "cancelado");
    }
  });

  it("não conhece `entregue` — foi fundido em `concluido` na Fase 1", () => {
    expect(TODOS).not.toContain("entregue" as OrderStatus);
    for (const s of TODOS) {
      expect(ALLOWED_TRANSITIONS[s]).not.toContain("entregue" as OrderStatus);
    }
  });
});

describe("máquina de estados do pedido — limites por actor", () => {
  it("o cliente só cancela, e só enquanto o pedido está por confirmar", () => {
    expect(canTransition("novo", "cancelado", "customer")).toBe(true);
    expect(canTransition("confirmado", "cancelado", "customer")).toBe(false);
    expect(canTransition("em_preparacao", "cancelado", "customer")).toBe(false);
    expect(canTransition("novo", "confirmado", "customer")).toBe(false);
  });

  it("o motorista não confirma nem prepara pedidos", () => {
    expect(canTransition("novo", "confirmado", "driver")).toBe(false);
    expect(canTransition("confirmado", "em_preparacao", "driver")).toBe(false);
    expect(canTransition("em_preparacao", "pronto", "driver")).toBe(false);
  });

  it("o motorista faz a parte logística", () => {
    expect(canTransition("motorista_encontrado", "pedido_recolhido", "driver")).toBe(true);
    expect(canTransition("pedido_recolhido", "a_caminho", "driver")).toBe(true);
    expect(canTransition("a_caminho", "concluido", "driver")).toBe(true);
  });

  it("o motorista não cancela o pedido de um restaurante", () => {
    expect(canTransition("aguardando_motorista", "cancelado", "driver")).toBe(false);
    expect(canTransition("pedido_recolhido", "cancelado", "driver")).toBe(false);
  });

  it("o admin corrige fora da máquina de estados — é a válvula deliberada", () => {
    expect(canTransition("concluido", "novo", "admin")).toBe(true);
    expect(canTransition("cancelado", "confirmado", "admin")).toBe(true);
  });
});

describe("máquina de estados do pedido — caminho feliz", () => {
  it("percorre o fluxo de entrega de ponta a ponta", () => {
    const fluxo: OrderStatus[] = [
      "novo",
      "confirmado",
      "em_preparacao",
      "pronto",
      "aguardando_motorista",
      "motorista_encontrado",
      "pedido_recolhido",
      "a_caminho",
      "concluido",
    ];
    for (let i = 0; i < fluxo.length - 1; i++) {
      expect(canTransition(fluxo[i], fluxo[i + 1], "owner")).toBe(true);
    }
  });

  it("permite fechar um pedido de balcão sem passar por motorista", () => {
    expect(canTransition("pronto", "concluido", "owner")).toBe(true);
  });

  it("o painel do restaurante nunca oferece um botão que o servidor recuse", () => {
    for (const [de, destinos] of Object.entries(RESTAURANT_PANEL_STEPS)) {
      for (const para of destinos) {
        expect(
          canTransition(de as OrderStatus, para, "owner"),
          `o painel oferece ${de} -> ${para}, que o servidor recusa`,
        ).toBe(true);
      }
    }
  });

  it("nextStatuses nunca devolve uma transição que canTransition recuse", () => {
    const actores: Actor[] = ["owner", "driver", "customer", "admin"];
    for (const actor of actores) {
      for (const from of TODOS) {
        for (const to of nextStatuses(from, actor)) {
          expect(canTransition(from, to, actor)).toBe(true);
        }
      }
    }
  });
});
