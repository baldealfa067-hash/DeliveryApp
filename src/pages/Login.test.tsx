import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Mock useAuth to simulate unauthenticated user in "choose" mode
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate, useSearchParams: () => [new URLSearchParams(), vi.fn()] };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    isAdmin: false,
    isBusiness: false,
    isClient: false,
    rolesLoaded: true,
    loading: false,
    session: null,
    roles: [],
    signOut: vi.fn(),
  }),
}));

// Mock supabase to avoid real calls
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signInWithPassword: vi.fn(), signUp: vi.fn(), signInWithOAuth: vi.fn(), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }), getSession: () => Promise.resolve({ data: { session: null } }) }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }), rpc: vi.fn(() => Promise.resolve({ data: null, error: null })) },
}));

import Login from "./Login";

/**
 * Estes testes afirmavam que o ecra' de escolha tinha um cartao "Motorista" e
 * que clica-lo abria o registo independente. O Aditamento 1 do documento
 * mestre reverteu essa funcionalidade: na V1 so' frotas se registam como
 * operadores logisticos, e e' a frota que cadastra os seus motoristas
 * (§11, §12).
 *
 * Passam agora a afirmar o contrario, de proposito. Nao foram apagados: e' a
 * rede que apanha alguem a repor o auto-registo por engano numa fase futura,
 * e deixa escrito no codigo que a remocao foi uma decisao, nao um descuido.
 */
describe("Login - registo de motorista foi revertido (Aditamento 1)", () => {
  beforeEach(() => { mockNavigate.mockClear(); });

  it("nao mostra o cartao Motorista no ecra de escolha", () => {
    render(<MemoryRouter><Login /></MemoryRouter>);
    expect(screen.queryByText("Motorista")).not.toBeInTheDocument();
    expect(screen.queryByText("Entregar pedidos e ganhar dinheiro")).not.toBeInTheDocument();
  });

  it("nao ha caminho no ecra de escolha que abra o registo de motorista", () => {
    render(<MemoryRouter><Login /></MemoryRouter>);
    expect(screen.queryByText("Conta de Motorista")).not.toBeInTheDocument();
    expect(screen.queryByText("Cria a tua conta para comecar a entregar")).not.toBeInTheDocument();
  });

  it("continua a oferecer Restaurante, que e o unico perfil profissional da V1", () => {
    render(<MemoryRouter><Login /></MemoryRouter>);
    expect(screen.getByText("Restaurante")).toBeInTheDocument();
  });

  it("clicar em Cliente nao atira ninguem para o painel de motorista", () => {
    render(<MemoryRouter><Login /></MemoryRouter>);
    const clienteCard = screen.getByText(/Cliente/i).closest(".cursor-pointer") as HTMLElement;
    fireEvent.click(clienteCard);
    expect(mockNavigate).not.toHaveBeenCalledWith("/painel-motorista");
  });
});
