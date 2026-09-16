/**
 * Fase 9.2 — um erro de rede NÃO pode aparecer como "não tem pedidos".
 *
 * O defeito: com a consulta a falhar, `data` fica `[]` por omissão e o ecrã caía
 * no estado vazio. Dizer a um cliente que não encomendou nada, quando só não se
 * conseguiu ler, pode levá-lo a encomendar outra vez (§73). O teste fixa os dois
 * lados, porque o risco de uma correcção é inverter o erro: mostrar "falhou" a
 * quem genuinamente não tem pedidos.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import MyOrdersPage from "./MyOrdersPage";

const estado = { data: [] as unknown[], isLoading: false, isError: false, refetch: vi.fn() };

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u1", email: "c955000000@deliveryapp.gw" }, loading: false }),
}));
vi.mock("@/hooks/useOrders", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useOrders")>()),
  useCustomerOrders: () => estado,
}));

const desenhar = () =>
  render(<MemoryRouter><MyOrdersPage /></MemoryRouter>);

describe("MyOrdersPage — falha vs vazio", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("pt");
    Object.assign(estado, { data: [], isLoading: false, isError: false });
  });

  it("com ERRO mostra a falha e o botão de tentar de novo — não o estado vazio", () => {
    Object.assign(estado, { isError: true });
    desenhar();
    expect(screen.getByText(i18n.t("common.errorLoading"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: new RegExp(i18n.t("common.tryAgain")) })).toBeInTheDocument();
    expect(screen.queryByText(i18n.t("myOrders.empty"))).not.toBeInTheDocument();
  });

  it("SEM erro e sem pedidos mostra o estado vazio — não uma falha que não houve", () => {
    desenhar();
    expect(screen.getByText(i18n.t("myOrders.empty"))).toBeInTheDocument();
    expect(screen.queryByText(i18n.t("common.errorLoading"))).not.toBeInTheDocument();
  });

  it("o botão de tentar de novo volta mesmo a pedir os dados", () => {
    Object.assign(estado, { isError: true });
    desenhar();
    screen.getByRole("button", { name: new RegExp(i18n.t("common.tryAgain")) }).click();
    expect(estado.refetch).toHaveBeenCalled();
  });
});
