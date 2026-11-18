import { supabase } from "@/integrations/supabase/client";

export type PostLoginDestination = "/painel-frota" | "/painel-motorista" | "/painel-loja" | "/painel-beleza" | "/inicio" | "/admin";

/**
 * Decide destino pós-login com prioridade Glovo-like:
 * 1. frota → /painel-frota (o dono de uma frota gere a operação; se também
 *    conduzir, chega ao painel de motorista pelo menu)
 * 2. drivers → /painel-motorista
 * 3. business → /painel-loja
 * 4. beleza → /painel-beleza
 * 5. default → /inicio
 * Admin tem prioridade máxima quando os papéis já foram carregados.
 */
export async function getPostLoginDestination(userId: string, knownRoles?: readonly string[]): Promise<PostLoginDestination> {
  if (knownRoles?.includes("admin")) return "/admin";
  if (knownRoles?.includes("fleet")) return "/painel-frota";

  // 1. dono de frota (tabela fleets, não user_roles)
  const { data: fleet, error: fleetError } = await supabase
    .from("fleets" as never)
    .select("id")
    .eq("owner_user_id", userId)
    .maybeSingle();
  if (fleetError) throw fleetError;
  if (fleet) return "/painel-frota";

  // 2. driver (tabela drivers, não user_roles)
  const { data: driver, error: driverError } = await supabase
    .from("drivers")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (driverError) throw driverError;
  if (driver) return "/painel-motorista";

  // 3. business / beleza via profiles (fonte primária) + fallback via user_roles
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("profile_type")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileError) throw profileError;
  if (profile?.profile_type === "business") return "/painel-loja";
  if (profile?.profile_type === "beleza") return "/painel-beleza";

  // Fallback via user_roles (caso profiles desatualizado, ex: provider legacy)
  let roles = knownRoles;
  if (!roles) {
    const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (error) throw error;
    roles = (data ?? []).map(({ role }) => role);
  }
  const roleSet = new Set(roles);
  if (roleSet.has("admin")) return "/admin";
  if (roleSet.has("business")) return "/painel-loja";
  if (roleSet.has("beleza")) return "/painel-beleza";

  return "/inicio";
}
