import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import i18n from "@/i18n";
import AdminDashboard from "./AdminDashboard";

const { send, getHistory } = vi.hoisted(() => ({
  send: vi.fn(),
  getHistory: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: admin, isAdmin: true, loading: false }),
}));

const admin = { id: "preview-admin", email: "admin@example.com" };

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from(table: string) {
      const data = table === "admin_notifications" ? getHistory() : [];
      const result = Promise.resolve({ data, count: data.length, error: null });
      const query = {
        select: () => query,
        order: () => query,
        is: () => query,
        not: () => query,
        range: () => result,
        then: result.then.bind(result),
      };
      return query;
    },
    channel() {
      const channel = { on: () => channel, subscribe: () => channel };
      return channel;
    },
    removeChannel: vi.fn(),
    rpc: (name: string, args: unknown) =>
      name === "send_bulk_notification" ? send(args) : Promise.resolve({ data: [], error: null }),
  },
}));

it("confirma os destinatários antes de enviar e atualiza o histórico", async () => {
  await i18n.changeLanguage("pt");
  getHistory.mockReturnValue([]);
  send.mockImplementation(async () => {
    getHistory.mockReturnValue([{
      id: "notification-1",
      title: "Atualização da operação",
      body: "Novo horário de recolha",
      target_groups: ["fleet", "driver"],
      recipients_count: 2,
      created_at: "2026-11-18T09:00:00Z",
    }]);
    return { data: 2, error: null };
  });

  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter><AdminDashboard /></MemoryRouter>
    </QueryClientProvider>,
  );

  const menu = await screen.findAllByRole("button", { name: i18n.t("admin.sendNotification") });
  fireEvent.click(menu[0]);
  fireEvent.change(screen.getByLabelText(i18n.t("admin.notifTitle")), { target: { value: " Atualização da operação " } });
  fireEvent.change(screen.getByLabelText(i18n.t("admin.notifMessage")), { target: { value: " Novo horário de recolha " } });
  fireEvent.click(screen.getByRole("checkbox", { name: i18n.t("admin.notifFleets") }));
  fireEvent.click(screen.getByRole("checkbox", { name: i18n.t("admin.notifDrivers") }));

  const sendButton = within(screen.getByRole("main")).getByRole("button", { name: i18n.t("admin.notifSend") });
  fireEvent.click(sendButton);
  expect(send).not.toHaveBeenCalled();
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent("Frotas, Motoristas");
  fireEvent.click(within(dialog).getByRole("button", { name: i18n.t("admin.notifSend") }));

  await waitFor(() => expect(send).toHaveBeenCalledExactlyOnceWith({
    p_title: "Atualização da operação",
    p_body: "Novo horário de recolha",
    p_target_groups: ["fleet", "driver"],
  }));
  expect(await screen.findByText("2 destinatários")).toBeInTheDocument();
});
