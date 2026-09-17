import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Comprovativos de pagamento Orange Money (2026-09-17) — bucket PRIVADO.
 *
 * `orders.payment_proof_url` guarda o NOME do objecto (`<uid>/<ficheiro>`), não
 * uma URL. A imagem abre-se só por URL assinado de vida curta, e é o Storage que
 * decide quem o pode pedir (policy `pode_ver_comprovativo`): o cliente que enviou,
 * o dono do restaurante do pedido e o admin. Um comprovativo ligado a um pedido
 * não pode ser apagado nem substituído.
 */
export const COMPROVATIVOS_BUCKET = "comprovativos";

/** Vida do URL assinado. Curta: enquanto vive, abre para quem o tiver. */
export const COMPROVATIVO_URL_SEGUNDOS = 300;

export const caminhoComprovativo = (userId: string, file: File): string => {
  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  return `${userId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
};

/**
 * URL para mostrar um comprovativo. Aceita também uma URL antiga completa (antes
 * do bucket privado), que é devolvida tal e qual.
 */
export const useComprovativoUrl = (ref: string | null | undefined) =>
  useQuery({
    queryKey: ["comprovativo-url", ref],
    enabled: !!ref,
    // Renova antes de expirar, para uma miniatura aberta não ficar partida.
    staleTime: (COMPROVATIVO_URL_SEGUNDOS - 60) * 1000,
    refetchInterval: (COMPROVATIVO_URL_SEGUNDOS - 60) * 1000,
    queryFn: async (): Promise<string | null> => {
      if (!ref) return null;
      if (/^https?:\/\//.test(ref)) return ref;
      const { data, error } = await supabase.storage
        .from(COMPROVATIVOS_BUCKET)
        .createSignedUrl(ref, COMPROVATIVO_URL_SEGUNDOS);
      if (error) throw error;
      return data.signedUrl;
    },
  });
