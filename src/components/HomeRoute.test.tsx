import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

/**
 * O ecrã de entrada (Entrar / Criar conta) é só para quem chega sem sessão.
 * Quem tem sessão tem de ir direito a /inicio — por "/" e por "/landing".
 */

let authMock = { user: null as { id: string } | null, loading: false };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => authMock }));

import HomeRoute from "./HomeRoute";

const montar = (rota: string) =>
  render(
    <MemoryRouter initialEntries={[rota]}>
      <Routes>
        <Route path="/" element={<HomeRoute><div>ECRA DE ENTRADA</div></HomeRoute>} />
        <Route path="/landing" element={<HomeRoute><div>ECRA DE ENTRADA</div></HomeRoute>} />
        <Route path="/inicio" element={<div>INICIO</div>} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  authMock = { user: null, loading: false };
});

describe("HomeRoute", () => {
  it.each(["/", "/landing"])("visitante sem sessão vê o ecrã de entrada em %s", (rota) => {
    montar(rota);
    expect(screen.getByText("ECRA DE ENTRADA")).toBeTruthy();
  });

  it.each(["/", "/landing"])("com sessão vai para /inicio e NÃO vê o ecrã de entrada em %s", (rota) => {
    authMock = { user: { id: "u1" }, loading: false };
    montar(rota);
    expect(screen.getByText("INICIO")).toBeTruthy();
    expect(screen.queryByText("ECRA DE ENTRADA")).toBeNull();
  });

  it("enquanto a sessão carrega não mostra o ecrã de entrada (sem piscar)", () => {
    authMock = { user: null, loading: true };
    montar("/");
    expect(screen.queryByText("ECRA DE ENTRADA")).toBeNull();
  });
});
