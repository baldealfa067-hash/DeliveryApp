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
 * Admin tem prioridade máxima mas é tratado antes (se quiser manter).
 */
export async function getPostLoginDestination(userId: string): Promise<PostLoginDestination> {
  // 1. dono de frota (tabela fleets, não user_roles)
  const { data: fleet } = await supabase
    .from("fleets" as never)
    .select("id")
    .eq("owner_user_id", userId)
    .maybeSingle();
  if (fleet) return "/painel-frota";

  // 2. driver (tabela drivers, não user_roles)
  const { data: driver } = await supabase
    .from("drivers")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (driver) return "/painel-motorista";

  // 3. business / beleza via profiles (fonte primária) + fallback via user_roles
  const { data: profile } = await supabase
    .from("profiles")
    .select("profile_type")
    .eq("user_id", userId)
    .maybeSingle();

  if (profile?.profile_type === "business") return "/painel-loja";
  if (profile?.profile_type === "beleza") return "/painel-beleza";

  // Fallback via user_roles (caso profiles desatualizado, ex: provider legacy)
  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const roleSet = new Set((roles ?? []).map((r: { role: string }) => r.role));
  if (roleSet.has("admin")) return "/admin";
  if (roleSet.has("business")) return "/painel-loja";
  if (roleSet.has("beleza")) return "/painel-beleza";

  return "/inicio";
}
