import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

/**
 * Guardas de isolamento por tipo de conta. Cada papel só vê a sua interface;
 * quem quiser outro cria uma conta separada.
 */

let authMock = {
  user: { id: "u1" } as { id: string } | null,
  roles: [] as string[],
  isBusiness: false,
  isAdmin: false,
  rolesLoaded: true,
  loading: false,
};
let driverMock: { data: unknown; isLoading: boolean } = { data: null, isLoading: false };

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => authMock }));
vi.mock("@/hooks/useDrivers", () => ({ useDriverProfile: () => driverMock }));

import RequireClientArea from "./RequireClientArea";
import RequireRole from "./RequireRole";

const montar = (guarda: React.ReactNode) =>
  render(
    <MemoryRouter initialEntries={["/inicio"]}>
      <Routes>
        <Route path="/inicio" element={guarda} />
        <Route path="/painel-loja" element={<div>PAINEL LOJA</div>} />
        <Route path="/painel-motorista" element={<div>PAINEL MOTORISTA</div>} />
        <Route path="/login" element={<div>LOGIN</div>} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  authMock = { user: { id: "u1" }, roles: ["client"], isBusiness: false, isAdmin: false, rolesLoaded: true, loading: false };
  driverMock = { data: null, isLoading: false };
});

describe("RequireClientArea", () => {
  it("deixa passar um cliente", () => {
    montar(<RequireClientArea><div>AREA CLIENTE</div></RequireClientArea>);
    expect(screen.getByText("AREA CLIENTE")).toBeTruthy();
  });

  it("manda um restaurante para o seu painel", () => {
    authMock = { ...authMock, roles: ["business"], isBusiness: true };
    montar(<RequireClientArea><div>AREA CLIENTE</div></RequireClientArea>);
    expect(screen.getByText("PAINEL LOJA")).toBeTruthy();
  });

  it("manda um motorista para o seu painel", () => {
    driverMock = { data: { id: "d1" }, isLoading: false };
    montar(<RequireClientArea><div>AREA CLIENTE</div></RequireClientArea>);
    expect(screen.getByText("PAINEL MOTORISTA")).toBeTruthy();
  });

  it("deixa passar visitante sem sessão — a conta só é exigida ao encomendar", () => {
    authMock = { ...authMock, user: null, roles: [] };
    montar(<RequireClientArea><div>AREA CLIENTE</div></RequireClientArea>);
    expect(screen.getByText("AREA CLIENTE")).toBeTruthy();
  });

  it("espera pelos papéis antes de decidir, para não mostrar a área errada", () => {
    authMock = { ...authMock, rolesLoaded: false };
    montar(<RequireClientArea><div>AREA CLIENTE</div></RequireClientArea>);
    expect(screen.queryByText("AREA CLIENTE")).toBeNull();
  });
});

describe("RequireRole", () => {
  it("bloqueia um cliente no painel de restaurante", () => {
    montar(<RequireRole roles={["business"]}><div>PAINEL PRIVADO</div></RequireRole>);
    expect(screen.queryByText("PAINEL PRIVADO")).toBeNull();
  });

  it("deixa entrar quem tem o papel", () => {
    authMock = { ...authMock, roles: ["business"], isBusiness: true };
    montar(<RequireRole roles={["business"]}><div>PAINEL PRIVADO</div></RequireRole>);
    expect(screen.getByText("PAINEL PRIVADO")).toBeTruthy();
  });

  it("o admin passa em qualquer painel, para dar apoio", () => {
    authMock = { ...authMock, roles: ["admin"], isAdmin: true };
    montar(<RequireRole roles={["business"]}><div>PAINEL PRIVADO</div></RequireRole>);
    expect(screen.getByText("PAINEL PRIVADO")).toBeTruthy();
  });

  it("sem sessão vai para o login", () => {
    authMock = { ...authMock, user: null, roles: [] };
    montar(<RequireRole roles={["business"]}><div>PAINEL PRIVADO</div></RequireRole>);
    expect(screen.getByText("LOGIN")).toBeTruthy();
  });
});

/**
 * A raiz e' a porta da area de cliente. Antes ficava aberta, e uma conta de
 * trabalho que abrisse o site caia na pagina de marketing sem saida util.
 */
describe("raiz do site", () => {
  const montarRaiz = () =>
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<RequireClientArea><div>LANDING</div></RequireClientArea>} />
          <Route path="/painel-loja" element={<div>PAINEL LOJA</div>} />
          <Route path="/painel-motorista" element={<div>PAINEL MOTORISTA</div>} />
        </Routes>
      </MemoryRouter>
    );

  it("manda um restaurante para o seu painel em vez da pagina de marketing", () => {
    authMock = { ...authMock, roles: ["business"], isBusiness: true };
    montarRaiz();
    expect(screen.getByText("PAINEL LOJA")).toBeTruthy();
  });

  it("manda um motorista para o seu painel", () => {
    driverMock = { data: { id: "d1" }, isLoading: false };
    montarRaiz();
    expect(screen.getByText("PAINEL MOTORISTA")).toBeTruthy();
  });

  it("visitante sem sessao continua a ver a landing", () => {
    authMock = { ...authMock, user: null, roles: [] };
    montarRaiz();
    expect(screen.getByText("LANDING")).toBeTruthy();
  });
});
