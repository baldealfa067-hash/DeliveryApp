import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

describe("Login — cadastro de motorista independente", () => {
  beforeEach(() => { mockNavigate.mockClear(); });

  it("oferece uma página própria para o motorista independente", () => {
    render(<MemoryRouter><Login /></MemoryRouter>);
    expect(screen.getByRole("link", { name: /Motorista independente/ })).toHaveAttribute("href", "/registar-motorista");
  });

  it("abre o cadastro por telefone e PIN a partir do link do motorista", () => {
    render(<MemoryRouter initialEntries={["/login?mode=motorista&tab=registar"]}><Login /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Motorista independente" })).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveAttribute("id", expect.stringContaining("signup"));
    expect(screen.queryByLabelText(/palavra-passe/i)).not.toBeInTheDocument();
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
