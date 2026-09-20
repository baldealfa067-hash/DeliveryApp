import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Ficheiros privados (2026-09-17): comprovativos de pedido, notas de voz e
 * comprovativos de comissão.
 *
 * As colunas guardam o NOME do objecto (`<uid>/<ficheiro>`), não uma URL. Abre-se
 * só por URL assinado de vida curta, e é o Storage que decide quem o pode pedir —
 * as policies de cada bucket, no servidor. Um ficheiro ligado a um pedido ou a um
 * pagamento não se apaga nem se substitui.
 *
 * Referências antigas (URL pública completa, de antes dos buckets privados)
 * continuam a abrir tal e qual, até o script de migração as mover.
 */
export const BUCKET_PRIVADO = {
  comprovativos: "comprovativos",
  notasVoz: "notas-voz",
  comprovativosComissao: "comprovativos-comissao",
} as const;
export type BucketPrivado = (typeof BUCKET_PRIVADO)[keyof typeof BUCKET_PRIVADO];

/** Vida do URL assinado. Curta: enquanto vive, abre para quem o tiver. */
export const URL_PRIVADO_SEGUNDOS = 300;

/** `<uid>/[subpasta/]<instante>-<uuid>.<ext>`. A 1.ª pasta TEM de ser o uid: é o
 *  que as policies de envio e de apagar verificam. */
export const caminhoPrivado = (userId: string, ext: string, subpasta?: string): string => {
  const e = ext.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const meio = subpasta ? `${subpasta.replace(/^\/+|\/+$/g, "")}/` : "";
  return `${userId}/${meio}${Date.now()}-${crypto.randomUUID()}.${e}`;
};

/** O Storage compara o tipo com `audio/*`/`image/*`; "audio/webm;codecs=opus" leva
 *  os parâmetros fora para não arriscar a recusa. */
export const tipoSemParametros = (tipo: string | undefined, omissao: string): string =>
  (tipo ?? "").split(";")[0].trim() || omissao;

export const ehUrlCompleta = (ref: string): boolean => /^(https?:|blob:|data:)/.test(ref);

export const obterUrlPrivado = async (bucket: BucketPrivado, ref: string): Promise<string> => {
  if (ehUrlCompleta(ref)) return ref;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(ref, URL_PRIVADO_SEGUNDOS);
  if (error) throw error;
  return data.signedUrl;
};

export const useUrlPrivado = (bucket: BucketPrivado, ref: string | null | undefined) =>
  useQuery({
    queryKey: ["url-privado", bucket, ref],
    enabled: !!ref,
    // Renova antes de expirar, para um áudio ou imagem aberto não ficar partido.
    staleTime: (URL_PRIVADO_SEGUNDOS - 60) * 1000,
    refetchInterval: (URL_PRIVADO_SEGUNDOS - 60) * 1000,
    queryFn: () => obterUrlPrivado(bucket, ref as string),
  });
