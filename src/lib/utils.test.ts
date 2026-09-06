import { describe, it, expect } from "vitest";
import { cn } from "./utils";

/**
 * O tailwind-merge tem de conhecer os tokens do sistema de design, senão
 * classifica-os no grupo errado e deita-os fora silenciosamente — o erro não
 * aparece na compilação, só no ecrã.
 */
describe("cn com os tokens do sistema de design", () => {
  it("mantém o tamanho do texto quando combinado com uma cor", () => {
    expect(cn("text-title", "text-foreground")).toBe("text-title text-foreground");
    expect(cn("text-caption", "text-muted-foreground")).toBe("text-caption text-muted-foreground");
    expect(cn("text-price", "text-primary")).toBe("text-price text-primary");
  });

  it("substitui a sombra default dos componentes shadcn", () => {
    expect(cn("shadow-sm", "shadow-soft")).toBe("shadow-soft");
    expect(cn("shadow-sm", "shadow-elevated")).toBe("shadow-elevated");
  });

  it("continua a resolver conflitos entre tokens do mesmo grupo", () => {
    expect(cn("text-body", "text-title")).toBe("text-title");
    expect(cn("shadow-soft", "shadow-elevated")).toBe("shadow-elevated");
  });
});
