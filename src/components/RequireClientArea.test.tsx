import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guardas por tipo de conta.
 *
 * Duas regras diferentes, que já se confundiram uma vez e por isso ficam aqui
 * separadas:
 *
 *  - RequireRole fecha os painéis de gestão. É o isolamento a sério.
 *  - RequireClientArea só escolhe o destino por omissão de quem tem conta de
 *    trabalho, e só na raiz do site. Navegar, pedir e acompanhar não passam
 *    por aqui — ver o bloco "área pública" no fim do ficheiro.
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
    <MemoryRouter initialEntries={["/rota-com-guarda"]}>
      <Routes>
        <Route path="/rota-com-guarda" element={guarda} />
        <Route path="/painel-loja" element={<div>PAINEL LOJA</div>} />
        <Route path="/painel-motorista" element={<div>PAINEL MOTORISTA</div>} />
        <Route path="/login" element={<div>LOGIN</div>} />
        {/* Destino de quem e' recusado num painel: a navegacao aberta. */}
        <Route path="/inicio" element={<div>NAVEGACAO ABERTA</div>} />
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
  it("bloqueia um cliente no painel de restaurante e devolve-o a navegação", () => {
    montar(<RequireRole roles={["business"]}><div>PAINEL PRIVADO</div></RequireRole>);
    expect(screen.queryByText("PAINEL PRIVADO")).toBeNull();
    expect(screen.getByText("NAVEGACAO ABERTA")).toBeTruthy();
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

/**
 * Área pública: aberta a qualquer conta autenticada.
 *
 * Navegar, ver menus, pedir e acompanhar o pedido. Não é "área de cliente" —
 * é a app, e um dono de restaurante usa-a como qualquer pessoa, além de ter o
 * seu painel de gestão. A regra já foi ao contrário uma vez: estas rotas
 * estiveram envolvidas em RequireClientArea e uma conta de trabalho era
 * atirada para o painel ao tentar usá-las. Pior ainda em /meus-pedidos, onde
 * o servidor deixava fazer o pedido e a interface não deixava vê-lo.
 *
 * O teste lê a tabela de rotas em vez de montar a App inteira: o que interessa
 * garantir é precisamente que nenhuma guarda de tipo de conta lá volta a ser
 * posta, e é isso que se lê na tabela. Se alguém reintroduzir a guarda, falha.
 */
describe("área pública", () => {
  // A raiz do vitest é a raiz do repo (vitest.config.ts), portanto o caminho
  // relativo ao cwd é estável.
  const app = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf-8");

  const linhaDaRota = (caminho: string) => {
    const linha = app.split("\n").find((l) => l.includes(`path="${caminho}"`));
    expect(linha, `rota ${caminho} não encontrada em App.tsx`).toBeTruthy();
    return linha!;
  };

  it.each(["/inicio", "/explorar", "/loja/:id", "/meus-pedidos", "/pedido/:id"])(
    "%s não tem guarda de tipo de conta",
    (caminho) => {
      expect(linhaDaRota(caminho)).not.toContain("RequireClientArea");
      expect(linhaDaRota(caminho)).not.toContain("RequireRole");
    },
  );

  // O contraponto: os painéis de gestão continuam fechados. Se isto falhar,
  // a correção foi longe de mais e abriu o que nunca podia abrir.
  it.each(["/painel-loja", "/painel-loja/editar", "/painel-motorista"])(
    "%s continua fechado por RequireRole",
    (caminho) => {
      expect(linhaDaRota(caminho)).toContain("RequireRole");
    },
  );
});
