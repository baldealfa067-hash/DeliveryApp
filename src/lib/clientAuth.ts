/**
 * Credenciais de cliente a partir de telefone + PIN.
 *
 * O cliente escolhe um PIN e a password do Supabase Auth é derivada dele de
 * forma determinística: o mesmo telefone com o mesmo PIN produz sempre a mesma
 * credencial. É isso que torna a conta recuperável noutro telemóvel — antes a
 * password era aleatória e nunca mostrada a ninguém, portanto quem perdia a
 * sessão perdia a conta.
 *
 * ATENÇÃO: SALT, formato e normalização do telefone fazem parte do contrato.
 * Mudar qualquer um deles gera passwords diferentes e tranca fora toda a gente
 * que já tenha conta. Se alguma vez for preciso mudar, é com migração das
 * credenciais existentes, não com uma edição destas constantes.
 *
 * Limitação conhecida e aceite: um PIN de 4 dígitos tem 10 000 combinações.
 * Serve para este contexto — valor baixo por conta, e SMS custa dinheiro no
 * mercado — mas não é uma solução definitiva.
 */

const SALT = "deliveryapp:client:v1";
const EMAIL_DOMAIN = "deliveryapp.gw";

export const PIN_LENGTH = 4;

/**
 * Reduz o telefone à sua forma canónica. Tem de ser idêntica no registo e no
 * login: qualquer diferença gera outro email e, portanto, outra conta.
 * "+245 955 123 456", "00245955123456" e "0955123456" são a mesma pessoa.
 */
export const normalizePhone = (raw: string): string => {
  let digits = (raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("00245")) digits = digits.slice(5);
  // Só corta o indicativo quando o comprimento o confirma: um número local de
  // 9 dígitos pode começar por 245 e não deve ser truncado.
  else if (digits.length === 12 && digits.startsWith("245")) digits = digits.slice(3);
  return digits.replace(/^0+/, "");
};

export const isValidPhone = (raw: string): boolean => {
  const digits = normalizePhone(raw);
  return digits.length >= 7 && digits.length <= 9;
};

export const isValidPin = (pin: string): boolean =>
  new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin ?? "");

/** Identificador único no Supabase Auth. Sintético — não recebe email. */
export const clientEmail = (rawPhone: string): string =>
  `c${normalizePhone(rawPhone)}@${EMAIL_DOMAIN}`;

/**
 * Password determinística. O prefixo fixo garante maiúscula, minúscula, dígito
 * e símbolo, para passar em regras de complexidade do lado do Supabase.
 */
export const derivePassword = async (rawPhone: string, pin: string): Promise<string> => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    // Só acontece fora de contexto seguro (http:// que não seja localhost).
    throw new Error("crypto.subtle indisponível — a app tem de correr em HTTPS");
  }
  const bytes = new TextEncoder().encode(`${SALT}|${normalizePhone(rawPhone)}|${pin}`);
  const digest = await subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `Dg1!${hex.slice(0, 40)}`;
};

/** Traduz os erros do Supabase Auth para chaves de mensagem nossas. */
export const clientAuthErrorKey = (message: string | undefined, acao: "signup" | "login"): string => {
  const m = (message ?? "").toLowerCase();
  if (m.includes("already registered") || m.includes("already been registered") || m.includes("user already")) {
    return "auth.phoneTaken";
  }
  if (m.includes("invalid login credentials")) return "auth.wrongPhoneOrPin";
  if (m.includes("email not confirmed")) return "auth.needsEmailConfirmOff";
  return acao === "signup" ? "auth.registerError" : "auth.loginError";
};
