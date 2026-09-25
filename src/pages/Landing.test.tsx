import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * Dois comportamentos (2026-09-25): no BROWSER a landing de marketing; na APP
 * INSTALADA (standalone) o ecrã simples de entrar, sem a landing pelo meio.
 */

let standalone = false;
vi.mock("@/lib/push", () => ({ isStandalone: () => standalone, isIOS: () => false }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: "pt" } }) }));
vi.mock("@/components/LanguageSelector", () => ({ LanguageSelector: () => null }));

import Landing from "./Landing";

const montar = () =>
  render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>
  );

beforeEach(() => {
  standalone = false;
});

describe("Landing", () => {
  it("no browser mostra a landing de marketing, com Entrar e Criar conta", () => {
    montar();
    // O título do hero é a tagline do iTudoo, não a frase do Bornaal.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("landing.tagline");
    expect(screen.getByText("landing.howTitle")).toBeTruthy();
    expect(screen.getByText("landing.whyTitle")).toBeTruthy();
    expect(screen.getByText("landing.appTitle")).toBeTruthy();
    expect(screen.getByText("landing.signIn").closest("a")?.getAttribute("href")).toBe("/login?mode=cliente");
  });

  it("na app instalada salta a landing e mostra o ecrã simples", () => {
    standalone = true;
    montar();
    expect(screen.queryByText("landing.howTitle")).toBeNull();
    expect(screen.getByText("landing.signIn").closest("a")?.getAttribute("href")).toBe("/login?mode=cliente");
    expect(screen.getByText("landing.createAccount").closest("a")?.getAttribute("href")).toBe("/login?tab=registar");
  });

  it("nos dois modos há uma porta à vista para navegar sem conta", () => {
    for (const modo of [false, true]) {
      standalone = modo;
      const { unmount } = montar();
      expect(screen.getByText("landing.browse").closest("a")?.getAttribute("href")).toBe("/inicio");
      unmount();
    }
  });

  it("o hero escuro usa o logótipo BRANCO e o ecrã claro o PRETO", () => {
    montar();
    const doHero = screen.getAllByAltText("iTudoo")[0].getAttribute("src") ?? "";
    expect(doHero).toContain("branco");
    standalone = true;
    const { container } = montar();
    const doEcraSimples = container.querySelector("img")?.getAttribute("src") ?? "";
    expect(doEcraSimples).toContain("preto");
  });
});
