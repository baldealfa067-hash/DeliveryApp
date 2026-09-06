import { describe, it, expect } from "vitest";
import { normalizePhone, isValidPhone, isValidPin, clientEmail, derivePassword } from "./clientAuth";

describe("normalizePhone", () => {
  it("reduz as várias formas do mesmo número à mesma canónica", () => {
    const esperado = "955123456";
    for (const forma of ["955123456", "955 123 456", "+245 955 123 456", "00245955123456", "0955123456", "(955) 123-456"]) {
      expect(normalizePhone(forma)).toBe(esperado);
    }
  });

  it("não corta 245 de um número local que por acaso comece por 245", () => {
    expect(normalizePhone("245123456")).toBe("245123456");
  });

  it("valida o comprimento", () => {
    expect(isValidPhone("955123456")).toBe(true);
    expect(isValidPhone("12345")).toBe(false);
    expect(isValidPhone("")).toBe(false);
  });
});

describe("isValidPin", () => {
  it("aceita exatamente 4 dígitos", () => {
    expect(isValidPin("1234")).toBe(true);
    expect(isValidPin("123")).toBe(false);
    expect(isValidPin("12345")).toBe(false);
    expect(isValidPin("12a4")).toBe(false);
  });
});

describe("derivePassword", () => {
  it("é determinística — a mesma entrada dá sempre a mesma password", async () => {
    const a = await derivePassword("955123456", "1234");
    const b = await derivePassword("955123456", "1234");
    expect(a).toBe(b);
  });

  it("é estável entre formas diferentes do mesmo telefone", async () => {
    const a = await derivePassword("+245 955 123 456", "1234");
    const b = await derivePassword("0955123456", "1234");
    expect(a).toBe(b);
    expect(clientEmail("+245 955 123 456")).toBe(clientEmail("0955123456"));
  });

  it("muda quando o PIN muda", async () => {
    const a = await derivePassword("955123456", "1234");
    const b = await derivePassword("955123456", "4321");
    expect(a).not.toBe(b);
  });

  it("cumpre as regras de complexidade do Supabase", async () => {
    const p = await derivePassword("955123456", "1234");
    expect(p.length).toBeGreaterThanOrEqual(8);
    expect(p).toMatch(/[A-Z]/);
    expect(p).toMatch(/[a-z]/);
    expect(p).toMatch(/[0-9]/);
    expect(p).toMatch(/[^A-Za-z0-9]/);
  });
});
