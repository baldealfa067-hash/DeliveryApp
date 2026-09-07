import { describe, it, expect, vi, afterEach } from "vitest";
import { isPasswordBreached } from "./passwordBreach";

// SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
const PREFIX = "5BAA6";
const SUFFIX = "1E4C9B93F3F0682250B6CF8331B7EE68FD8";

const respondWith = (body: string, ok = true) =>
  vi.fn().mockResolvedValue({ ok, text: () => Promise.resolve(body) });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isPasswordBreached", () => {
  it("only sends the first 5 characters of the hash, never the password", async () => {
    const fetchMock = respondWith("");
    vi.stubGlobal("fetch", fetchMock);

    await isPasswordBreached("password");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${PREFIX}`);

    // O que sai daqui é só o prefixo: nem a palavra-passe, nem o resto do hash,
    // que é o que tornaria o pedido rastreável até uma palavra-passe concreta.
    const sent = String(url).split("/range/")[1];
    expect(sent).toBe(PREFIX);
    expect(sent).not.toContain(SUFFIX);
    expect(init?.body).toBeUndefined();
  });

  it("detects the suffix in the returned list", async () => {
    vi.stubGlobal("fetch", respondWith(`00000000000000000000000000000000000:3\r\n${SUFFIX}:24230577\r\n`));
    expect(await isPasswordBreached("password")).toBe(true);
  });

  it("clears a password whose suffix is absent", async () => {
    vi.stubGlobal("fetch", respondWith("00000000000000000000000000000000000:3\r\n"));
    expect(await isPasswordBreached("password")).toBe(false);
  });

  it("ignores padding entries, which come with a count of zero", async () => {
    vi.stubGlobal("fetch", respondWith(`${SUFFIX}:0\r\n`));
    expect(await isPasswordBreached("password")).toBe(false);
  });

  // Falhar ao contrário trancaria o registo à conta de um serviço externo.
  it("lets the password through when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await isPasswordBreached("password")).toBe(false);
  });

  it("lets the password through on a non-OK response", async () => {
    vi.stubGlobal("fetch", respondWith("", false));
    expect(await isPasswordBreached("password")).toBe(false);
  });

  it("never calls the API for an empty password", async () => {
    const fetchMock = respondWith("");
    vi.stubGlobal("fetch", fetchMock);
    expect(await isPasswordBreached("")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
