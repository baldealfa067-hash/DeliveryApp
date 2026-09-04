import { supabase } from "@/integrations/supabase/client";

export type PostLoginDestination = "/painel-motorista" | "/painel-loja" | "/painel-beleza" | "/inicio" | "/admin";

/**
 * Decide destino pós-login com prioridade Glovo-like:
 * 1. drivers → /painel-motorista
 * 2. business → /painel-loja
 * 3. beleza → /painel-beleza
 * 4. default → /inicio
 * Admin tem prioridade máxima mas é tratado antes (se quiser manter).
 */
export async function getPostLoginDestination(userId: string): Promise<PostLoginDestination> {
  // 1. driver tem prioridade máxima (tabela drivers, não user_roles)
  const { data: driver } = await supabase
    .from("drivers")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (driver) return "/painel-motorista";

  // 2. business / beleza via profiles (fonte primária) + fallback via user_roles
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
