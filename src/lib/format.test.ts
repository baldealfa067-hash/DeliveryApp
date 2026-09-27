import { describe, it, expect } from "vitest";
import { formatCFA } from "./format";

// Um preço não se pode partir entre linhas (auditoria de layout, 2026-09-27):
// nenhum espaço QUEBRÁVEL dentro do valor formatado.
describe("formatCFA", () => {
  it.each([0, 500, 9333, 28000, 1250000])("%i não tem espaços quebráveis", (v) => {
    const s = formatCFA(v);
    expect(s.endsWith("\u00a0CFA")).toBe(true);
    expect(/[ \t\n]/.test(s)).toBe(false);
  });

  it("agrupa os milhares", () => {
    expect(formatCFA(28000).replace(/\u00a0/g, " ")).toBe("28 000 CFA");
    expect(formatCFA(1250000).replace(/\u00a0/g, " ")).toBe("1 250 000 CFA");
  });

  it("nulo dá texto vazio, zero não", () => {
    expect(formatCFA(null)).toBe("");
    expect(formatCFA(undefined)).toBe("");
    expect(formatCFA(0).replace(/\u00a0/g, " ")).toBe("0 CFA");
  });
});
