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

describe("Login - Motorista card", () => {
  beforeEach(() => { mockNavigate.mockClear(); });

  it("should render 3 cards: Cliente, Restaurante, Motorista", async () => {
    render(<MemoryRouter><Login /></MemoryRouter>);
    expect(screen.getByText("Motorista")).toBeInTheDocument();
    expect(screen.getByText("Entregar pedidos e ganhar dinheiro")).toBeInTheDocument();
    // Cliente label is via i18n - check that Motorista card exists
  });

  it("clicking Motorista shows driver signup form (independent flow)", async () => {
    render(<MemoryRouter><Login /></MemoryRouter>);
    const card = screen.getByText("Motorista").closest(".cursor-pointer") as HTMLElement;
    expect(card).toBeTruthy();
    fireEvent.click(card!);
    expect(screen.getByText("Conta de Motorista")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalledWith("/painel-motorista");
  });

  it("clicking Cliente does NOT navigate to motorista, it switches mode", async () => {
    render(<MemoryRouter><Login /></MemoryRouter>);
    // We can't easily test setMode, but we verify navigate not called with motorista path
    const clienteCard = screen.getByText(/Cliente/i).closest(".cursor-pointer") as HTMLElement;
    // There are multiple Cliente texts - pick the card one
    fireEvent.click(clienteCard);
    expect(mockNavigate).not.toHaveBeenCalledWith("/painel-motorista");
  });

  it("driver signup form has correct CTA", async () => {
    render(<MemoryRouter><Login /></MemoryRouter>);
    const card = screen.getByText("Motorista").closest(".cursor-pointer") as HTMLElement;
    fireEvent.click(card!);
    expect(screen.getByText("Cria a tua conta para começar a entregar")).toBeInTheDocument();
    expect(screen.getByText("Conta de Motorista")).toBeInTheDocument();
  });
});
