/**
 * Rejeita palavras-passe que já apareceram em fugas de dados públicas.
 *
 * A palavra-passe NUNCA sai do telemóvel. Usa-se o modelo de k-anonimato do
 * HaveIBeenPwned: calcula-se o SHA-1 localmente, envia-se só os 5 primeiros
 * caracteres do hash e recebe-se de volta a lista de todos os sufixos que
 * começam por esse prefixo (algumas centenas). A comparação é feita aqui. O
 * servidor deles nunca fica a saber qual dos sufixos era o nosso, nem sequer
 * se algum era.
 *
 * Porquê aqui e não no Supabase: a verificação nativa do Supabase Auth existe
 * mas é exclusiva do plano Pro, e o projecto está no plano gratuito. Isto é o
 * substituto possível.
 *
 * LIMITE ASSUMIDO: isto corre no browser, tal como o minLength do campo. Quem
 * chamar /auth/v1/signup directamente contorna-o. Não serve contra ataques
 * automatizados — serve contra a pessoa real que ia escrever "12345678".
 *
 * Só se aplica a contas de restaurante, motorista e admin, que escolhem uma
 * palavra-passe. As contas de cliente não passam por aqui: a credencial delas
 * é derivada do telefone + PIN em [clientAuth.ts] e é sempre única.
 */

/** Passado este tempo desiste-se. A rede em Bissau é lenta e o registo não pode ficar preso. */
const TIMEOUT_MS = 4000;

const sha1Hex = async (text: string): Promise<string | null> => {
  const subtle = globalThis.crypto?.subtle;
  // Indisponível fora de contexto seguro (http:// que não seja localhost).
  if (!subtle) return null;
  const digest = await subtle.digest("SHA-1", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
};

/**
 * `true` só quando há confirmação de que a palavra-passe está numa fuga
 * conhecida.
 *
 * Em qualquer outra situação — sem rede, API em baixo, resposta estranha,
 * tempo esgotado — devolve `false` e deixa passar. É deliberado: falhar ao
 * contrário trancaria o registo à conta de um serviço externo de que não
 * dependemos para nada. Vale mais uma palavra-passe fraca a passar do que um
 * restaurante impedido de se registar porque a rede caiu.
 */
export const isPasswordBreached = async (password: string): Promise<boolean> => {
  if (!password) return false;
  try {
    const hash = await sha1Hex(password);
    if (!hash) return false;
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);

    // AbortController em vez de AbortSignal.timeout(): este último não existe
    // em WebViews Android mais antigas, que são metade dos telemóveis aqui.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let body: string;
    try {
      const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        // Enche a resposta com resultados falsos até um tamanho fixo, para que
        // o tamanho do tráfego não deixe adivinhar nada sobre o prefixo.
        headers: { "Add-Padding": "true" },
        signal: controller.signal,
      });
      if (!response.ok) return false;
      body = await response.text();
    } finally {
      clearTimeout(timer);
    }

    for (const line of body.split("\n")) {
      const [candidate, count] = line.trim().split(":");
      // O padding vem com contagem 0 — são sufixos inventados, a ignorar.
      if (candidate === suffix && Number(count) > 0) return true;
    }
    return false;
  } catch {
    return false;
  }
};
