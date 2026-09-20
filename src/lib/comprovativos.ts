import { BUCKET_PRIVADO, URL_PRIVADO_SEGUNDOS, caminhoPrivado, useUrlPrivado } from "@/lib/armazenamentoPrivado";

/**
 * Comprovativos de pagamento Orange Money de um pedido — bucket privado
 * `comprovativos`. Ver `armazenamentoPrivado.ts` para o desenho comum.
 * Lêem: o cliente que enviou, o dono do restaurante do pedido e o admin.
 */
export const COMPROVATIVOS_BUCKET = BUCKET_PRIVADO.comprovativos;
export const COMPROVATIVO_URL_SEGUNDOS = URL_PRIVADO_SEGUNDOS;

export const caminhoComprovativo = (userId: string, file: File): string =>
  caminhoPrivado(userId, file.name.split(".").pop() ?? "jpg");

export const useComprovativoUrl = (ref: string | null | undefined) => useUrlPrivado(COMPROVATIVOS_BUCKET, ref);
