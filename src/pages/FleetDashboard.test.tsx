import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { expect, it, vi } from "vitest";
import i18n from "@/i18n";
import FleetDashboard from "./FleetDashboard";

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "fleet-owner" }, loading: false, signOut }),
}));
vi.mock("@/hooks/useFleetFinancials", () => ({ useFleetFinancials: () => ({}) }));
vi.mock("@/components/FleetDriverDetail", () => ({ FleetDriverDetail: () => null }));
vi.mock("@/components/FleetCashClosing", () => ({ FleetCashClosing: () => null }));
vi.mock("@/hooks/useFleet", () => ({
  useFleetMetrics: () => ({
    data: {
      fleet_id: "fleet-1", fleet_name: "Frota de teste", entregas: 0, concluidas: 0,
      motoristas_activos: 0, motoristas: 0, valor_entregas: 0,
    },
    isLoading: false,
  }),
  useFleetDrivers: () => ({}),
  useZonePrices: () => ({}),
  useCreateFleet: () => ({}),
  useAddDriver: () => ({}),
  useSetDriverActive: () => ({}),
  useRemoveDriver: () => ({}),
  useResetDriverPin: () => ({}),
  useUpsertZonePrice: () => ({}),
}));

const LoginDestination = () => <p>{useLocation().search}</p>;

it("encerra a sessão da frota e encaminha para o login de frota", async () => {
  await i18n.changeLanguage("pt");
  signOut.mockResolvedValue({ error: null });

  render(
    <MemoryRouter initialEntries={["/painel-frota"]}>
      <Routes>
        <Route path="/painel-frota" element={<FleetDashboard />} />
        <Route path="/login" element={<LoginDestination />} />
      </Routes>
    </MemoryRouter>,
  );

  expect(screen.getByRole("link", { name: i18n.t("common.viewSite") })).toHaveAttribute("href", "/inicio");
  fireEvent.click(screen.getByRole("button", { name: i18n.t("common.logout") }));

  expect(await screen.findByText("?mode=frota")).toBeInTheDocument();
  expect(signOut).toHaveBeenCalledTimes(1);
});
