import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * Regressão do bug de 2026-09-10: "conta criada" seguido de "PIN errado".
 *
 * O que acontecia, medido nos registos do GoTrue:
 *   POST /signup -> 422 user_already_exists
 *   POST /token  -> 400 invalid_credentials  (x4, nos 10 segundos seguintes)
 *
 * O telefone já tinha conta. O diálogo mostrava a mensagem num toast que
 * desaparecia, saltava para o separador Entrar, e deixava lá o PIN acabado de
 * inventar. Quem carregasse em Entrar levava "Telefone ou PIN errado" — e lia
 * a sequência como "a conta foi criada e agora o PIN não serve", quando o que
 * se passou foi que a conta já existia e o PIN pedido era o DELA.
 *
 * Estes testes prendem as duas metades da correcção: o PIN não transita, e o
 * aviso fica no ecrã em vez de passar num toast.
 */

const signUp = vi.fn();
const signInWithPassword = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signUp: (...a: unknown[]) => signUp(...a),
      signInWithPassword: (...a: unknown[]) => signInWithPassword(...a),
    },
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { ClientSignupDialog } from "./ClientSignupDialog";

const abrir = () =>
  render(
    <ClientSignupDialog open onOpenChange={() => {}} onSuccess={() => {}} />,
  );

/** Preenche e submete o registo com um telefone e PIN válidos. */
const registar = async (telefone: string, pin: string) => {
  fireEvent.change(screen.getByLabelText("auth.name"), { target: { value: "Teste" } });
  const campos = screen.getAllByLabelText(/auth\.(phone|choosePin|confirmPin)/);
  fireEvent.change(campos[0], { target: { value: telefone } });
  fireEvent.change(screen.getByLabelText("auth.choosePin"), { target: { value: pin } });
  fireEvent.change(screen.getByLabelText("auth.confirmPin"), { target: { value: pin } });
  fireEvent.click(screen.getByRole("button", { name: "auth.createClientAccount" }));
};

describe("ClientSignupDialog — telefone já registado", () => {
  beforeEach(() => {
    signUp.mockReset();
    signInWithPassword.mockReset();
    signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "User already registered" },
    });
  });

  it("não leva o PIN inventado para o formulário de entrada", async () => {
    abrir();
    await registar("966804992", "1234");

    // Aterra no separador Entrar, mas com o campo de PIN vazio: o PIN que
    // interessa agora é o da conta que já existe, não o que foi escolhido.
    const pinEntrada = await screen.findByLabelText("auth.pin");
    expect((pinEntrada as HTMLInputElement).value).toBe("");
  });

  it("deixa o aviso no ecrã, não só num toast que passa", async () => {
    abrir();
    await registar("966804992", "1234");

    const aviso = await screen.findByRole("status");
    expect(aviso.textContent).toContain("auth.phoneTakenNotice");
  });

  it("nunca chega a tentar entrar com o PIN inventado", async () => {
    abrir();
    await registar("966804992", "1234");

    // Era isto que produzia o 400 invalid_credentials logo a seguir ao 422.
    await waitFor(() => expect(signUp).toHaveBeenCalled());
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("limpa o aviso quando o telefone é mudado", async () => {
    abrir();
    await registar("966804992", "1234");
    await screen.findByRole("status");

    const telefone = screen.getByLabelText("auth.phone");
    fireEvent.change(telefone, { target: { value: "955000111" } });

    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });
});
