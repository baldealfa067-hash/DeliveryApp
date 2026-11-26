import { fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import RequireRole from "@/components/RequireRole";
import type { AppRole } from "@/hooks/useAuth";
import Profile from "./Profile";

const auth = vi.hoisted(() => ({
  user: { id: "account", user_metadata: { name: "Conta Teste" } },
  roles: ["client"] as string[],
  rolesLoaded: true,
  loading: false,
  isClient: true,
  signOut: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/usePushSettings", () => ({ usePushSettings: () => ({}) }));
vi.mock("@/hooks/useProviderStats", () => ({
  useProviderStatsQuery: () => ({}),
  useCommentCount: () => ({}),
  useCommentCountRealtime: () => {},
  useQualityLevel: () => ({}),
  useQualityLevelRealtime: () => {},
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) },
}));

it.each([
  ["driver", "/painel-motorista"],
  ["business", "/painel-loja"],
] as const)("volta ao painel de %s a partir do perfil sem terminar a sessão", async (role, dashboard) => {
  auth.roles = ["client", role];
  auth.signOut.mockClear();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[dashboard]}>
        <Routes>
          <Route path={dashboard} element={
            <RequireRole roles={[role as AppRole]}>
              <h1>Painel de trabalho</h1>
              <Link to="/inicio">Visitar site</Link>
            </RequireRole>
          } />
          <Route path="/inicio" element={<Link to="/perfil">Perfil</Link>} />
          <Route path="/perfil" element={<Profile />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("link", { name: "Visitar site" }));
  fireEvent.click(screen.getByRole("link", { name: "Perfil" }));
  expect(await screen.findByRole("heading", { name: "Painel de trabalho" })).toBeInTheDocument();
  expect(auth.signOut).not.toHaveBeenCalled();
});
