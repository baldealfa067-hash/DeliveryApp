import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { RestaurantTeam } from "./RestaurantTeam";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    functions: { invoke },
  },
}));

it("guarda o telefone digitado e envia o número normalizado", async () => {
  await i18n.changeLanguage("pt");
  invoke.mockResolvedValue({ error: null });
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>
    <RestaurantTeam businessId="restaurant" />
  </MemoryRouter></QueryClientProvider>);
  const phone = screen.getByRole("textbox", { name: "Telefone" });
  fireEvent.change(phone, { target: { value: "955 123 456" } });
  expect(phone).toHaveValue("955 123 456");
  fireEvent.change(screen.getByLabelText("PIN de 6 dígitos"), { target: { value: "001234" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Pedidos" }));
  fireEvent.click(screen.getByRole("button", { name: "Criar funcionário" }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("restaurant-create-staff", {
    body: { businessId: "restaurant", phone: "955123456", pin: "001234", permissions: ["orders"] },
  }));
});
