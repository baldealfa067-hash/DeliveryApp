import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isChunkLoadError, handleChunkError, clearChunkRetry, CHUNK_RETRY_KEY } from "./chunkError";

const mockLocationReload = () => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { reload: vi.fn(), href: "" },
  });
};

describe("chunkError", () => {
  beforeEach(() => {
    clearChunkRetry();
    vi.restoreAllMocks();
    mockLocationReload();
  });

  afterEach(() => {
    clearChunkRetry();
  });

  it("detecciona erros de import dinâmico do Vite", () => {
    expect(isChunkLoadError(new Error("Failed to fetch dynamically imported module: https://.../Explore-DPU0LPCD.js"))).toBe(true);
    expect(isChunkLoadError(new Error("Importing a module script failed"))).toBe(true);
    expect(isChunkLoadError("error loading dynamically imported module")).toBe(true);
    expect(isChunkLoadError(new Error("Loading chunk 12 failed"))).toBe(true);
  });

  it("não deteta erros normais", () => {
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isChunkLoadError(new Error("user is not defined"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });

  it("recarrega uma vez e guarda a flag", () => {
    const reload = vi.mocked(window.location.reload);
    expect(handleChunkError()).toBe(true);
    expect(sessionStorage.getItem(CHUNK_RETRY_KEY)).toBe("1");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("na segunda ocorrência não recarrega (evita loop) e limpa a flag", () => {
    const reload = vi.mocked(window.location.reload);
    handleChunkError();
    reload.mockClear();
    expect(handleChunkError()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(CHUNK_RETRY_KEY)).toBeNull();
  });

  it("após arranque limpo (clearChunkRetry) volta a permitir recarga", () => {
    const reload = vi.mocked(window.location.reload);
    handleChunkError();
    clearChunkRetry();
    reload.mockClear();
    expect(handleChunkError()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});