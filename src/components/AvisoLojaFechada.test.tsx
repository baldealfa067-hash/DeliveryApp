/**
 * Loja fechada (2026-09-28): os dias do horário e os textos do aviso seguem o
 * idioma activo. Até aqui estavam escritos à mão em português — "Segunda …
 * Fechado" aparecia a quem tinha a app em inglês, francês ou kriol.
 */
import { describe, it, expect, afterAll } from "vitest";
import { render, screen } from "@testing-library/react";
import i18n from "@/i18n";
import pt from "@/i18n/locales/pt.json";
import en from "@/i18n/locales/en.json";
import fr from "@/i18n/locales/fr.json";
import kri from "@/i18n/locales/kri.json";
import { AvisoLojaFechada } from "./AvisoLojaFechada";

const LOCAIS = { pt, en, fr, kri } as const;
// Segunda (1) com dois períodos; os outros dias sem horário.
const periodos = [
  { weekday: 1, opens_at: "09:00", closes_at: "15:00" },
  { weekday: 1, opens_at: "18:00", closes_at: "23:00" },
];

describe("AvisoLojaFechada", () => {
  afterAll(() => i18n.changeLanguage("pt"));

  it.each(Object.keys(LOCAIS) as (keyof typeof LOCAIS)[])("em %s, os dias e o aviso vêm do idioma activo", async (lang) => {
    await i18n.changeLanguage(lang);
    const L = LOCAIS[lang];
    const { container } = render(<AvisoLojaFechada periodos={periodos} />);

    expect(screen.getByText(L.businessDetail.closedNow)).toBeInTheDocument();
    expect(screen.getByText(L.businessDetail.closedBrowseHint)).toBeInTheDocument();

    const linhas = [...container.querySelectorAll("[data-dia]")].map((p) => p.textContent ?? "");
    expect(linhas).toHaveLength(7);
    // Linha a linha, pelo índice do backend (0 = domingo).
    L.businessHours.days.forEach((dia, d) => expect(linhas[d].startsWith(dia)).toBe(true));
    expect(linhas[1]).toContain("09:00–15:00 · 18:00–23:00");
    expect(linhas[0]).toContain(L.businessHours.closed);

    // Nenhum dia em português fora do português.
    if (lang !== "pt") {
      for (const diaPt of pt.businessHours.days) {
        if (!L.businessHours.days.includes(diaPt)) expect(container.textContent).not.toContain(diaPt);
      }
      expect(container.textContent).not.toContain("Fechado neste momento");
    }
  });

  it("sem horário definido não lista dias e diz que não aceita pedidos", async () => {
    await i18n.changeLanguage("en");
    const { container } = render(<AvisoLojaFechada periodos={[]} />);
    expect(screen.getByText(en.businessDetail.notAcceptingNow)).toBeInTheDocument();
    expect(container.querySelectorAll("[data-dia]")).toHaveLength(0);
  });
});
