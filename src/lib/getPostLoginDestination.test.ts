import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFleetsMaybeSingle = vi.fn();
const mockDriversMaybeSingle = vi.fn();
const mockProfilesMaybeSingle = vi.fn();
const mockUserRolesResolve = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "fleets") return { select: () => ({ eq: () => ({ maybeSingle: mockFleetsMaybeSingle }) }) } as any;
      if (table === "drivers") return { select: () => ({ eq: () => ({ maybeSingle: mockDriversMaybeSingle }) }) } as any;
      if (table === "profiles") return { select: () => ({ eq: () => ({ maybeSingle: mockProfilesMaybeSingle }) }) } as any;
      if (table === "user_roles") return { select: () => ({ eq: () => Promise.resolve(mockUserRolesResolve()) }) } as any;
      return { select: () => ({ eq: () => ({ maybeSingle: vi.fn() }) }) } as any;
    },
  },
}));

import { getPostLoginDestination } from "./getPostLoginDestination";

describe("getPostLoginDestination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFleetsMaybeSingle.mockReset();
    // Sem frota, por omissão: cada teste que queira uma di-lo explicitamente.
    mockFleetsMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockDriversMaybeSingle.mockReset();
    mockProfilesMaybeSingle.mockReset();
    mockUserRolesResolve.mockReset();
  });

  it("1. só motorista (drivers existe) → /painel-motorista", async () => {
    mockDriversMaybeSingle.mockResolvedValueOnce({ data: { id: "d1" }, error: null });
    const dest = await getPostLoginDestination("uid-driver");
    expect(dest).toBe("/painel-motorista");
  });

  it("2. cliente normal (sem driver, sem business) → /inicio", async () => {
    mockDriversMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mockProfilesMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mockUserRolesResolve.mockReturnValue({ data: [], error: null });
    const dest = await getPostLoginDestination("uid-client");
    expect(dest).toBe("/inicio");
  });

  it("3. híbrido motorista+cliente → /painel-motorista (prioridade driver)", async () => {
    mockDriversMaybeSingle.mockResolvedValueOnce({ data: { id: "d1" }, error: null });
    const dest = await getPostLoginDestination("uid-hybrid");
    expect(dest).toBe("/painel-motorista");
  });

  it("4. business sem motorista → /painel-loja", async () => {
    mockDriversMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mockProfilesMaybeSingle.mockResolvedValueOnce({ data: { profile_type: "business" }, error: null });
    const dest = await getPostLoginDestination("uid-business");
    expect(dest).toBe("/painel-loja");
  });

  // ── Fase 3 ──────────────────────────────────────────────────────────────
  it("5. dono de frota → /painel-frota", async () => {
    mockFleetsMaybeSingle.mockResolvedValue({ data: { id: "f1" }, error: null });
    const dest = await getPostLoginDestination("uid-fleet");
    expect(dest).toBe("/painel-frota");
  });

  it("6. dono de frota que também conduz → /painel-frota (frota tem prioridade)", async () => {
    mockFleetsMaybeSingle.mockResolvedValue({ data: { id: "f1" }, error: null });
    mockDriversMaybeSingle.mockResolvedValue({ data: { id: "d1" }, error: null });
    const dest = await getPostLoginDestination("uid-fleet-driver");
    expect(dest).toBe("/painel-frota");
  });

  it("7. motorista de uma frota, sem frota própria → /painel-motorista", async () => {
    mockFleetsMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockDriversMaybeSingle.mockResolvedValueOnce({ data: { id: "d1" }, error: null });
    const dest = await getPostLoginDestination("uid-driver-of-fleet");
    expect(dest).toBe("/painel-motorista");
  });
});
