export const CHUNK_RETRY_KEY = "bornaal:chunk-retry";

const CHUNK_ERROR_PATTERNS = [
  "Failed to fetch dynamically imported module",
  "Importing a module script failed",
  "error loading dynamically imported module",
  "dynamically imported module",
  "Loading chunk",
  "Unable to preload CSS",
];

export const isChunkLoadError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : String(error ?? "");
  return CHUNK_ERROR_PATTERNS.some((p) => message.includes(p));
};

export const clearChunkRetry = () => {
  try {
    sessionStorage.removeItem(CHUNK_RETRY_KEY);
  } catch {
    // sessionStorage indisponível (modo privado) — ignora
  }
};

export const handleChunkError = (): boolean => {
  try {
    if (sessionStorage.getItem(CHUNK_RETRY_KEY) === "1") {
      sessionStorage.removeItem(CHUNK_RETRY_KEY);
      return false;
    }
    sessionStorage.setItem(CHUNK_RETRY_KEY, "1");
    window.location.reload();
    return true;
  } catch {
    window.location.reload();
    return true;
  }
};

export const installGlobalChunkErrorHandler = () => {
  const handler = (error: unknown) => {
    if (isChunkLoadError(error)) handleChunkError();
  };
  const onError = (event: ErrorEvent) => handler(event.error ?? event.message);
  const onRejection = (event: PromiseRejectionEvent) => handler(event.reason);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
};