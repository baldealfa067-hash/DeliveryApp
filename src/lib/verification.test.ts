import { describe, it, expect } from "vitest";
import {
  verificationLabel,
  verificationDescription,
  isVerifiedStatus,
  canSubmitVerification,
} from "./verification";

describe("verificationLabel", () => {
  it("maps each status to a label", () => {
    expect(verificationLabel("aprovado")).toBe("Verificado");
    expect(verificationLabel("pendente")).toBe("Em análise");
    expect(verificationLabel("rejeitado")).toBe("Rejeitado");
    expect(verificationLabel("none")).toBe("Sem verificação");
  });

  it("falls back to 'Sem verificação' for unknown/null/undefined values", () => {
    expect(verificationLabel("")).toBe("Sem verificação");
    expect(verificationLabel(null)).toBe("Sem verificação");
    expect(verificationLabel(undefined)).toBe("Sem verificação");
    expect(verificationLabel("estranho")).toBe("Sem verificação");
  });
});

describe("verificationDescription", () => {
  it("maps each status to a description", () => {
    expect(verificationDescription("aprovado")).toContain("verificad");
    expect(verificationDescription("pendente")).toContain("análise");
    expect(verificationDescription("rejeitado")).toContain("rejeitad");
    expect(verificationDescription("none")).toContain("verificar");
  });

  it("falls back to the default description for unknown values", () => {
    expect(verificationDescription("invalido")).toBe(
      "Envie um documento e selfie para verificar a sua identidade."
    );
  });
});

describe("isVerifiedStatus", () => {
  it("returns true only for 'aprovado'", () => {
    expect(isVerifiedStatus("aprovado")).toBe(true);
    expect(isVerifiedStatus("pendente")).toBe(false);
    expect(isVerifiedStatus("rejeitado")).toBe(false);
    expect(isVerifiedStatus("none")).toBe(false);
    expect(isVerifiedStatus(null)).toBe(false);
    expect(isVerifiedStatus(undefined)).toBe(false);
  });
});

describe("canSubmitVerification", () => {
  it("allows submission when there is no verification or it was rejected", () => {
    expect(canSubmitVerification("none")).toBe(true);
    expect(canSubmitVerification("rejeitado")).toBe(true);
  });

  it("blocks submission when pending or approved", () => {
    expect(canSubmitVerification("pendente")).toBe(false);
    expect(canSubmitVerification("aprovado")).toBe(false);
  });

  it("blocks submission for unknown values", () => {
    expect(canSubmitVerification(null)).toBe(false);
    expect(canSubmitVerification(undefined)).toBe(false);
  });
});