import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import i18n from "@/i18n";
import SendPage from "./SendPage";

const { submit } = vi.hoisted(() => ({ submit: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "test" }, loading: false }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) },
}));
vi.mock("@/hooks/useBairros", () => ({ useBairros: () => ({ data: ["Bandim"] }) }));
vi.mock("@/hooks/useGeolocation", () => {
  const detect = vi.fn();
  return { useGeolocation: () => ({ detect, position: { lat: 11.85, lng: -15.58 } }) };
});
vi.mock("@/hooks/useSendOrder", () => ({
  useDeliveryPrice: () => ({ data: { preco: 1000, fleet_name: "Frota" } }),
  useCreateSendOrder: () => ({ mutate: submit, isPending: false }),
}));
vi.mock("@/components/VoiceRecorderField", () => ({ VoiceRecorderField: () => null }));
vi.mock("@/components/DeliveryLocationMap", () => ({
  default: ({ onSelect }: { onSelect: (point: { lat: number; lng: number; accuracy: number }) => void }) => (
    <button type="button" onClick={() => onSelect({ lat: 11.86, lng: -15.59, accuracy: 0 })}>Marcar teste</button>
  ),
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: {
    value: string; onValueChange: (value: string) => void; children: ReactNode;
  }) => <select value={value} onChange={event => onValueChange(event.target.value)}>{children}</select>,
  SelectTrigger: () => <option value="">—</option>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => children,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => <option value={value}>{children}</option>,
}));

beforeEach(() => submit.mockClear());

it.each([
  ["documento", "typeDocument"],
  ["objeto", "typeObject"],
  ["outro", "typeOther"],
])("envia o ponto de destino separado da recolha para %s", async (tipo, label) => {
  render(<MemoryRouter><SendPage /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: i18n.t(`sendPage.${label}`) }));
  fireEvent.change(screen.getByPlaceholderText(i18n.t("sendPage.phonePlaceholder")), { target: { value: "955123456" } });
  const [pickup, drop] = screen.getAllByRole("combobox");
  fireEvent.change(drop, { target: { value: "Bandim" } });
  const confirm = screen.getByRole("button", { name: /Confirmar envio/ });
  expect(confirm).toBeDisabled();
  fireEvent.change(pickup, { target: { value: "Bandim" } });
  fireEvent.click(screen.getByRole("button", { name: i18n.t("businessDetail.deliveryMap") }));
  fireEvent.click(await screen.findByRole("button", { name: "Marcar teste" }));
  fireEvent.click(confirm);
  expect(submit).toHaveBeenLastCalledWith(expect.objectContaining({
    tipo, recolhaMorada: "Bandim", destinoMorada: "Bandim", recolhaLat: 11.85, recolhaLng: -15.58, destinoLat: 11.86, destinoLng: -15.59,
  }), expect.any(Object));

  fireEvent.click(screen.getByRole("button", { name: i18n.t("businessDetail.mapClearPoint") }));
  fireEvent.change(screen.getByRole("textbox", { name: i18n.t("sendPage.dropReference") }), { target: { value: "Casa azul" } });
  fireEvent.click(confirm);
  expect(submit).toHaveBeenLastCalledWith(expect.objectContaining({
    destinoMorada: "Bandim - Casa azul", destinoLat: null, destinoLng: null,
  }), expect.any(Object));
});
