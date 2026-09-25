import { useCallback, useEffect, useState } from "react";
import { isIOS } from "@/lib/push";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

/**
 * O botão "Instalar a app" da landing (§50: poucos passos).
 *
 * O Chrome/Android só deixa instalar a partir do evento `beforeinstallprompt`,
 * que chega quando o browser decide que a PWA é instalável — pode não chegar
 * nunca (iOS não o tem; outros browsers também não). Por isso devolve
 * `podeInstalar` e o ecrã mostra instruções em vez de um botão morto.
 * O `InstallPrompt` também escuta o evento: os dois recebem o mesmo.
 */
export const useInstallApp = () => {
  const [evento, setEvento] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const aoChegar = (e: Event) => {
      e.preventDefault();
      setEvento(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", aoChegar);
    return () => window.removeEventListener("beforeinstallprompt", aoChegar);
  }, []);

  const instalar = useCallback(async () => {
    if (!evento) return;
    await evento.prompt();
    await evento.userChoice;
    // O evento só serve uma vez.
    setEvento(null);
  }, [evento]);

  return { podeInstalar: evento !== null, instalar, ios: isIOS() };
};
