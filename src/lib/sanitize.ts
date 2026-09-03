/**
 * Fase 1 - sanitização mínima para XSS e limites
 * Usado em ProviderDetail, BusinessDetail, Requests, Reviews
 * React já escapa JSX, mas sanitizamos na origem para defesa em profundidade.
 */

export const sanitizeText = (input: string, maxLen: number): string => {
  if (!input) return "";
  // remove tags <...>, trim e limita tamanho
  let s = input.trim().replace(/<[^>]*>/g, "");
  // colapsa espaços múltiplos
  s = s.replace(/\s+/g, " ");
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
};

export const sanitizeName = (s: string) => sanitizeText(s, 50);
export const sanitizeComment = (s: string) => sanitizeText(s, 500);
export const sanitizeDescription = (s: string) => sanitizeText(s, 500);
export const sanitizeReason = (s: string) => sanitizeText(s, 100);
export const sanitizeContact = (s: string) => sanitizeText(s, 30);
