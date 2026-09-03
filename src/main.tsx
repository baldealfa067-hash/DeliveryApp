import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./i18n";
import { clearChunkRetry, installGlobalChunkErrorHandler } from "./lib/chunkError";

// Arranque com sucesso = versão atual carregada: permite nova tentativa
// automática na próxima publicação (evita loop infinito).
clearChunkRetry();

// Erros de import dinâmico que ocorram fora do React (ex: módulo principal)
// também disparam recarga automática única.
installGlobalChunkErrorHandler();

// PWA: regista o service worker após o carregamento inicial da página.
// Estrutura pronta para notificações push; sem cache de assets.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("Falha ao registar o service worker:", err);
    });
  });
}

createRoot(document.getElementById("root")!).render(<App />);