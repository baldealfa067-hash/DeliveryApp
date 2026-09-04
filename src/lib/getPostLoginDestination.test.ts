import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDriversMaybeSingle = vi.fn();
const mockProfilesMaybeSingle = vi.fn();
const mockUserRolesResolve = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
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
});
