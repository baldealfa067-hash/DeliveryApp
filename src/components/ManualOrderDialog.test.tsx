/**
 * Pedido manual com entrega (2026-09-27): o bairro é ESCOLHIDO de uma lista,
 * nunca escrito. Texto livre gravou "cupilum" no pedido #12 — sem frota, sem
 * taxa, parado para sempre.
 *
 * O servidor recusa na mesma (`scripts/pedido-manual-bairro-test.mjs`); aqui
 * fixa-se o que o ecrã faz:
 *  1. não há campo de texto para o bairro — há uma lista;
 *  2. "Lançar e procurar motorista" fica desligado até haver bairro COM frota;
 *  3. escolhido o bairro, a taxa da frota aparece e o total é comida + taxa.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n";
import { ManualOrderDialog } from "./ManualOrderDialog";

const rpc = vi.fn();
const configurePickup = vi.fn();
const menu = [
  { id: "m1", name: "Caldo de Mancarra", price: 3500, is_orderable: true, track_stock: false, stock_qty: null },
];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({
      select: () => ({ eq: () => ({ order: async () => ({ data: menu, error: null }) }) }),
    }),
  },
}));
vi.mock("@/hooks/useBairros", () => ({
  useBairros: () => ({ data: ["Bairro Militar", "Cupelum"] }),
}));
// A mesma função do checkout: get_delivery_price. "Cupelum" sem frota.
vi.mock("@/hooks/useFleet", () => ({
  useDeliveryPrice: (bairro: string | null) => ({
    isLoading: false,
    data: bairro === "Bairro Militar" ? { fleet_id: "f1", fleet_name: "Frota", preco: 1500 } : null,
  }),
}));

vi.mock("@/components/DeliveryLocationMap", () => ({
  default: ({ onSelect }: { onSelect: (point: { lat: number; lng: number; accuracy: number }) => void }) => (
    <button onClick={() => onSelect({ lat: 11.86, lng: -15.59, accuracy: 0 })}>Marcar destino</button>
  ),
}));

const desenhar = (pickupConfigured: boolean) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ManualOrderDialog businessId="b1" pickupConfigured={pickupConfigured} onConfigurePickup={configurePickup} />
    </QueryClientProvider>,
  );

// O Select do Radix usa APIs de ponteiro que o jsdom não tem.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

const abrirComEntrega = async (pickupConfigured = true) => {
  desenhar(pickupConfigured);
  fireEvent.click(screen.getByRole("button", { name: /Lançar pedido manual/ }));
  const d = await screen.findByRole("dialog");
  await within(d).findByText("Caldo de Mancarra");
  // + do único artigo (o − está desligado com 0)
  const mais = within(d).getAllByRole("button").filter((b) => b.querySelector("svg.lucide-plus"));
  fireEvent.click(mais[0]);
  fireEvent.click(within(d).getByRole("button", { name: "Entrega" }));
  return d;
};
const escolher = async (d: HTMLElement, bairro: string) => {
  fireEvent.keyDown(within(d).getByRole("combobox"), { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: bairro }));
};
const despachar = (d: HTMLElement) => within(d).getByRole("button", { name: /Lançar e procurar motorista/ });

describe("ManualOrderDialog — bairro da lista", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("pt");
    rpc.mockReset();
    rpc.mockResolvedValue({ data: "novo-id", error: null });
  });

  it("não tem campo de texto para o bairro: é uma lista", async () => {
    const d = await abrirComEntrega();
    expect(within(d).queryByPlaceholderText(/Bairro/i)).toBeNull();
    expect(within(d).getByRole("combobox")).toBeTruthy();
  });

  it("sem bairro escolhido não deixa despachar", async () => {
    const d = await abrirComEntrega();
    expect(despachar(d)).toBeDisabled();
  });

  it("bairro sem frota: avisa e continua sem deixar despachar", async () => {
    const d = await abrirComEntrega();
    await escolher(d, "Cupelum");
    expect(within(d).getByText(/Nenhuma frota entrega em Cupelum/)).toBeTruthy();
    expect(despachar(d)).toBeDisabled();
  });

  it("bloqueia entregas quando o restaurante não tem ponto de recolha", async () => {
    const d = await abrirComEntrega(false);
    await escolher(d, "Bairro Militar");
    expect(within(d).getByText(/Configura o ponto de recolha/)).toBeVisible();
    fireEvent.click(within(d).getByRole("button", { name: "Configurar ponto de recolha" }));
    expect(configurePickup).toHaveBeenCalled();
    expect(despachar(d)).toBeDisabled();
  });

  it("bairro com frota: mostra a taxa, soma ao total e envia o bairro escolhido", async () => {
    const d = await abrirComEntrega();
    await escolher(d, "Bairro Militar");
    expect(within(d).getByText("Taxa de entrega")).toBeTruthy();
    expect(within(d).getByText("Total a pagar")).toBeTruthy();
    // 3500 de comida + 1500 da frota
    expect(within(d).getAllByText((_, el) => el?.textContent?.replace(/\s/g, "") === "5000CFA").length).toBeGreaterThan(0);
    expect(despachar(d)).toBeDisabled();
    fireEvent.click(await within(d).findByRole("button", { name: "Marcar destino" }));
    expect(despachar(d)).not.toBeDisabled();

    fireEvent.click(despachar(d));
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    const [nome, args] = rpc.mock.calls[0];
    expect(nome).toBe("create_manual_order");
    expect(args).toMatchObject({ p_consumption_option: "entrega", p_bairro: "Bairro Militar", p_concluir: false, p_customer_lat: 11.86, p_customer_lng: -15.59 });
    // o preço nunca sai do ecrã: quem o resolve é o servidor
    expect(args).not.toHaveProperty("p_delivery_fee");
  });
});
