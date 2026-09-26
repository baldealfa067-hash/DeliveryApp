/**
 * Acompanhamento do pedido (2026-09-26) — três coisas que o cliente tem de ver.
 *
 * 1. Um ENVIO não se parece com um pedido de comida: sem "Comida: 0 CFA", com
 *    etiqueta de envio no topo e uma linha do tempo sem cozinha.
 * 2. A janela de cancelamento aparece — e só dentro dela. A regra é do servidor
 *    (`scripts/cancelamento-cliente-test.mjs`); aqui fixa-se que o ecrã a mostra.
 * 3. Quem chega do checkout/Enviar vê a confirmação de que o pedido foi criado.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n";
import OrderTrackingPage from "./OrderTrackingPage";

const base = {
  id: "o1", order_number: 42, customer_id: "u1", customer_name: "Cliente", customer_phone: "955000000",
  business_id: "b1", business_name: "Casa do Arroz", items: [{ name: "Arroz", price: 5000, qty: 2 }],
  total: 10000, delivery_fee: 1000, status: "novo", consumption_option: "entrega",
  address: "Perto do mercado", notes: null, preparation_time: null, created_at: "2026-09-26T10:00:00Z",
  updated_at: "2026-09-26T10:00:00Z", bairro: "Bandim", delivery_code: null, voice_note_url: null,
  payment_method: "entrega", payment_proof_url: null, payment_status: "pendente",
  business_phone: null, driver_name: null, driver_phone: null,
};
const envio = { ...base, business_id: null, business_name: "", items: [], total: 0, status: "aguardando_motorista" };

const estado = { data: [base] as unknown[], isLoading: false, isFetching: false, isError: false, refetch: vi.fn() };
const mutate = vi.fn();
const historico = { data: [] as Array<{ status: string; note: string | null; created_at: string }>, refetch: vi.fn() };
const hist = (...s: string[]) =>
  s.map((status, i) => ({ status, note: null, created_at: `2026-09-26T10:0${i}:00Z` }));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u1" }, loading: false }),
}));
vi.mock("@/hooks/useOrders", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useOrders")>()),
  useCustomerOrders: () => estado,
  useOrderHistory: () => historico,
  useUpdateOrderStatus: () => ({ mutate, isPending: false }),
}));

const desenhar = (state?: unknown) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[{ pathname: "/pedido/o1", state }]}>
        <Routes><Route path="/pedido/:id" element={<OrderTrackingPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("OrderTrackingPage", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("pt");
    estado.data = [base];
    historico.data = [];
    mutate.mockReset();
  });

  describe("envio vs pedido de comida", () => {
    it("num envio NÃO mostra a linha da comida, e diz que é um envio", () => {
      estado.data = [envio];
      desenhar();
      expect(screen.queryByText(i18n.t("orderTotals.food"))).not.toBeInTheDocument();
      expect(screen.getByText(i18n.t("orderTotals.deliveryFee"))).toBeInTheDocument();
      expect(screen.getByText(i18n.t("orderTracking.sendBadge"))).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(`${i18n.t("orderTracking.sendTitle")} #42`);
    });

    it("num envio, a linha do tempo não tem cozinha", () => {
      estado.data = [envio];
      desenhar();
      expect(screen.queryByText(i18n.t("orderStatus.em_preparacao"))).not.toBeInTheDocument();
      expect(screen.queryByText(i18n.t("orderStatus.confirmado"))).not.toBeInTheDocument();
    });

    it("num pedido de comida mantém a comida e não mostra a etiqueta de envio", () => {
      desenhar();
      expect(screen.getByText(i18n.t("orderTotals.food"))).toBeInTheDocument();
      expect(screen.queryByText(i18n.t("orderTracking.sendBadge"))).not.toBeInTheDocument();
    });
  });

  describe("cancelamento pelo cliente", () => {
    const botao = (envio = false) =>
      screen.queryByRole("button", { name: new RegExp(i18n.t(envio ? "orderTracking.cancelSend" : "orderTracking.cancelOrder")) });

    it("pedido de comida em `novo`: oferece cancelar e diz até quando", () => {
      desenhar();
      expect(screen.getByText(i18n.t("orderTracking.cancelUntilRestaurant"))).toBeInTheDocument();
      fireEvent.click(botao()!);
      fireEvent.click(screen.getByRole("button", { name: i18n.t("orderTracking.cancelConfirmYes") }));
      expect(mutate).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: "o1", newStatus: "cancelado" }),
        expect.anything(),
      );
    });

    it("pedido de comida já confirmado: sem botão, e diz porquê", () => {
      estado.data = [{ ...base, status: "confirmado" }];
      desenhar();
      expect(botao()).not.toBeInTheDocument();
      expect(screen.getByText(i18n.t("orderTracking.cancelClosedRestaurant"))).toBeInTheDocument();
    });

    it("envio à espera de motorista: oferece cancelar", () => {
      estado.data = [envio];
      desenhar();
      expect(botao(true)).toBeInTheDocument();
      expect(screen.getByText(i18n.t("orderTracking.cancelUntilDriver"))).toBeInTheDocument();
    });

    it("envio com motorista: sem botão", () => {
      estado.data = [{ ...envio, status: "motorista_encontrado" }];
      desenhar();
      expect(botao(true)).not.toBeInTheDocument();
      expect(screen.getByText(i18n.t("orderTracking.cancelClosedSend"))).toBeInTheDocument();
    });

    it("pedido terminado: nem botão nem aviso", () => {
      estado.data = [{ ...base, status: "cancelado" }];
      desenhar();
      expect(botao()).not.toBeInTheDocument();
      expect(screen.queryByText(i18n.t("orderTracking.cancelClosedRestaurant"))).not.toBeInTheDocument();
    });
  });

  describe("confirmação de pedido criado", () => {
    it("quem chega do checkout vê a confirmação", () => {
      desenhar({ criado: true });
      expect(screen.getByRole("dialog")).toHaveTextContent(i18n.t("orderPlaced.title"));
    });

    it("num envio a confirmação fala de envio", () => {
      estado.data = [envio];
      desenhar({ criado: true });
      expect(screen.getByRole("dialog")).toHaveTextContent(i18n.t("orderPlaced.titleSend"));
    });

    it("quem abre o pedido pela lista não a vê", () => {
      desenhar();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("acabado de criar, enquanto a lista não tem o pedido: carrega, não diz 'não encontrado'", () => {
      Object.assign(estado, { data: [], isFetching: true });
      desenhar({ criado: true });
      expect(screen.queryByText(i18n.t("orderTracking.notFound"))).not.toBeInTheDocument();
      Object.assign(estado, { isFetching: false });
    });
  });

  describe("linha do tempo de um pedido cancelado", () => {
    const passo = (k: string) => screen.queryByText(i18n.t(`orderStatus.${k}`), { selector: "p" });

    it("comida cancelada depois de confirmar: pára em Confirmado e acaba em Cancelado", () => {
      estado.data = [{ ...base, status: "cancelado" }];
      historico.data = hist("novo", "confirmado", "cancelado");
      desenhar();
      expect(passo("novo")).toBeInTheDocument();
      expect(passo("confirmado")).toBeInTheDocument();
      for (const futuro of ["em_preparacao", "pronto", "a_caminho", "concluido"]) {
        expect(passo(futuro)).not.toBeInTheDocument();
      }
      const fim = screen.getByTestId("timeline-cancelado");
      expect(fim).toHaveTextContent(i18n.t("orderStatus.cancelado"));
      // Cor do problema, não o cinzento neutro dos passos por vir.
      expect(fim.querySelector("p")).toHaveClass("text-problem");
    });

    it("envio cancelado à espera de motorista: só o primeiro passo, e Cancelado", () => {
      estado.data = [{ ...envio, status: "cancelado" }];
      historico.data = hist("aguardando_motorista", "cancelado");
      desenhar();
      expect(passo("aguardando_motorista")).toBeInTheDocument();
      expect(passo("motorista_encontrado")).not.toBeInTheDocument();
      expect(passo("a_caminho")).not.toBeInTheDocument();
      expect(screen.getByTestId("timeline-cancelado")).toBeInTheDocument();
    });

    it("um pedido NÃO cancelado continua a mostrar o percurso inteiro", () => {
      historico.data = hist("novo");
      desenhar();
      expect(passo("concluido")).toBeInTheDocument();
      expect(screen.queryByTestId("timeline-cancelado")).not.toBeInTheDocument();
    });
  });
});
