import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Mock useAuth to simulate unauthenticated user in "choose" mode
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate, useSearchParams: actual.useSearchParams };
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

describe("Login — registo público de clientes", () => {
  beforeEach(() => { mockNavigate.mockClear(); });

  it("apresenta o acesso de cliente e a entrada por e-mail", () => {
    render(<MemoryRouter><Login /></MemoryRouter>);
    expect(screen.getByRole("button", { name: /Entrar com telefone e PIN/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Entrar com e-mail" })).toBeInTheDocument();
    expect(screen.queryByText("Motorista independente")).not.toBeInTheDocument();
    expect(screen.queryByText("Restaurante")).not.toBeInTheDocument();
  });

  it("abre a entrada com PIN num link antigo de motorista", () => {
    render(<MemoryRouter initialEntries={["/login?mode=motorista&tab=registar"]}><Login /></MemoryRouter>);
    expect(screen.getByRole("tabpanel")).toHaveAttribute("id", expect.stringContaining("login"));
    expect(screen.getByLabelText("PIN")).toBeInTheDocument();
  });

  it("ignora o pedido de registo num link antigo de restaurante", () => {
    render(<MemoryRouter initialEntries={["/login?mode=restaurante&tab=registar"]}><Login /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Entrar com e-mail" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Registar" })).not.toBeInTheDocument();
  });

  it("mantém o formulário de criação de conta para clientes", () => {
    render(<MemoryRouter initialEntries={["/login?mode=cliente&tab=registar"]}><Login /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "Criar Conta" })).toBeInTheDocument();
  });
});
