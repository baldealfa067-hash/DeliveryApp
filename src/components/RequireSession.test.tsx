import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

/**
 * /painel-frota sem sessão ficava preso em "A carregar...". Sem sessão tem de ir
 * para o login ANTES de o ecrã montar — senão as RPCs da frota correm na mesma.
 */

let authMock = { user: null as { id: string } | null, loading: false };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => authMock }));

import RequireSession from "./RequireSession";

const montar = () =>
  render(
    <MemoryRouter initialEntries={["/painel-frota"]}>
      <Routes>
        <Route path="/painel-frota" element={<RequireSession><div>PAINEL DA FROTA</div></RequireSession>} />
        <Route path="/login" element={<div>LOGIN</div>} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  authMock = { user: null, loading: false };
});

describe("RequireSession", () => {
  it("sem sessão vai para o login e NÃO monta o ecrã", () => {
    montar();
    expect(screen.getByText("LOGIN")).toBeTruthy();
    expect(screen.queryByText("PAINEL DA FROTA")).toBeNull();
  });

  it("com sessão monta o ecrã, sem exigir papel nenhum", () => {
    authMock = { user: { id: "u1" }, loading: false };
    montar();
    expect(screen.getByText("PAINEL DA FROTA")).toBeTruthy();
  });

  it("enquanto a sessão carrega não monta o ecrã nem redirecciona", () => {
    authMock = { user: null, loading: true };
    montar();
    expect(screen.queryByText("PAINEL DA FROTA")).toBeNull();
    expect(screen.queryByText("LOGIN")).toBeNull();
  });
});
