import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

/**
 * O chat foi removido a 2026-09-25. As 6 notificações antigas de chat ficaram
 * na base com `link = '/contacto'` (migração remover_chat_links). Tocar numa
 * delas tem de levar ao ecrã de Contacto — não a um 404 de /mensagem/….
 */

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: "pt" } }) }));
vi.mock("@/components/LanguageSelector", () => ({ LanguageSelector: () => null }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" }, loading: false }) }));
vi.mock("@/hooks/useNotifications", () => ({
  useNotifications: () => ({
    data: [
      {
        id: "n1",
        user_id: "u1",
        title: "Nova mensagem",
        message: "Tem uma mensagem nova",
        type: "info",
        is_read: true,
        created_at: new Date().toISOString(),
        // Como a linha real está gravada depois da migração.
        reference_type: "chat",
        reference_id: "2b4d4f41-8a9f-4c52-a0ad-2ff9cffb6c6d",
        link: "/contacto",
      },
    ],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useMarkNotificationsRead: () => ({ mutate: vi.fn() }),
}));

import NotificationsPage from "./NotificationsPage";
import ContactPage from "./ContactPage";

describe("notificação antiga de chat", () => {
  it("abre o ecrã de Contacto com os dois números, e não /mensagem/…", () => {
    render(
      <MemoryRouter initialEntries={["/notificacoes"]}>
        <Routes>
          <Route path="/notificacoes" element={<NotificationsPage />} />
          <Route path="/contacto" element={<ContactPage />} />
          <Route path="*" element={<div>NAO ENCONTRADO</div>} />
        </Routes>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText("Nova mensagem"));
    expect(screen.queryByText("NAO ENCONTRADO")).toBeNull();
    expect(screen.getByText("teamContact.title")).toBeTruthy();
    expect(screen.getByText("+245 957 107 795")).toBeTruthy();
    expect(screen.getByText("+245 966 804 992")).toBeTruthy();
  });
});
