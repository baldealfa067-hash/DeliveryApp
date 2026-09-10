/**
 * fleet-create-driver — a frota cria a conta do motorista.
 *
 * PORQUE E' UMA EDGE FUNCTION E NAO UMA RPC:
 * criar uma conta em `auth.users` a partir de SQL exigiria escrever a password
 * no formato bcrypt que o GoTrue espera, mais a linha em `auth.identities` e o
 * resto do que o GoTrue monta. E' fragil e sai do contrato suportado. A API de
 * administracao faz isso correctamente, mas precisa da chave service_role, que
 * nunca pode estar no frontend (§49). Uma Edge Function e' o unico sitio deste
 * projecto onde essa chave vive -- ja' e' assim em `push-send`.
 *
 * A PASSWORD NAO E' UM FORMATO NOVO: e' exactamente o contrato de
 * src/lib/clientAuth.ts -- SHA-256("deliveryapp:client:v1"|telefone|PIN),
 * prefixado com "Dg1!" e cortado nos 40 primeiros hex. Tem de bater certo ao
 * bit, senao a conta e' criada e o motorista nunca consegue entrar. As duas
 * implementacoes andam juntas; ha' um vector de teste partilhado em
 * src/lib/clientAuth.test.ts.
 *
 * AUTORIZACAO: a criacao da conta so' acontece DEPOIS de confirmado, com o JWT
 * de quem chama, que existe uma frota cuja `owner_user_id` e' esse utilizador.
 * A associacao em si e' delegada a `add_driver_to_fleet`, chamada com o mesmo
 * JWT -- as guardas ficam onde ja' estavam e ja' estao testadas, em vez de
 * serem reescritas aqui com service_role a passar por cima do RLS.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const SALT = "deliveryapp:client:v1";
const EMAIL_DOMAIN = "deliveryapp.gw";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

/** Espelha normalizePhone() de src/lib/clientAuth.ts. */
function normalizePhone(raw: string): string {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.startsWith("00245")) d = d.slice(5);
  else if (d.length === 12 && d.startsWith("245")) d = d.slice(3);
  return d.replace(/^0+/, "");
}

/** Espelha derivePassword() de src/lib/clientAuth.ts. */
async function derivePassword(phone: string, pin: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${SALT}|${normalizePhone(phone)}|${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `Dg1!${hex.slice(0, 40)}`;
}

const clientEmail = (phone: string) => `c${normalizePhone(phone)}@${EMAIL_DOMAIN}`;

/** PIN de 4 digitos com aleatoriedade criptografica, nao Math.random(). */
function gerarPin(): string {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return String(n[0] % 10000).padStart(4, "0");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Sem sessão" }, 401);

  // Cabecalhos que actuam COMO QUEM CHAMA: o RLS aplica-se normalmente.
  const comoChamador = { Authorization: auth, apikey: ANON_KEY, "Content-Type": "application/json" };

  let corpo: { name?: string; phone?: string; vehicleType?: string };
  try {
    corpo = await req.json();
  } catch {
    return json({ error: "Corpo inválido" }, 400);
  }

  const nome = (corpo.name ?? "").trim();
  const telefone = normalizePhone(corpo.phone ?? "");
  const veiculo = (corpo.vehicleType ?? "moto").trim() || "moto";

  if (!nome) return json({ error: "Nome obrigatório" }, 400);
  if (telefone.length < 7 || telefone.length > 9) {
    return json({ error: "Telefone inválido" }, 400);
  }
  if (!["moto", "bicicleta", "carro", "pe"].includes(veiculo)) {
    return json({ error: "Tipo de veículo inválido" }, 400);
  }

  // ── 1. Quem chama? ───────────────────────────────────────────────────────
  const rUser = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: comoChamador });
  if (!rUser.ok) return json({ error: "Sessão inválida" }, 401);
  const utilizador = await rUser.json();
  if (!utilizador?.id) return json({ error: "Sessão inválida" }, 401);

  // ── 2. É dono de uma frota? ──────────────────────────────────────────────
  // Consultado com o JWT do chamador: se o RLS não deixar ver a linha, não há
  // frota para efeitos desta chamada. Nada é criado antes desta verificação.
  const rFrota = await fetch(
    `${SUPABASE_URL}/rest/v1/fleets?owner_user_id=eq.${utilizador.id}&select=id&limit=1`,
    { headers: comoChamador },
  );
  if (!rFrota.ok) return json({ error: "Não foi possível confirmar a frota" }, 500);
  const frotas = await rFrota.json();
  if (!Array.isArray(frotas) || frotas.length === 0) {
    return json({ error: "Só o dono de uma frota pode criar motoristas" }, 403);
  }

  // ── 3. Já existe conta com este telefone? ────────────────────────────────
  // Se existir, não se cria nada: associa-se a que existe, e não há PIN novo
  // para devolver — a pessoa entra com o PIN dela. É o fluxo antigo, mantido
  // como caminho de recurso em vez de dar erro.
  const email = clientEmail(telefone);
  const rProcura = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`,
    { headers: { Authorization: `Bearer ${SERVICE_ROLE}`, apikey: SERVICE_ROLE } },
  );
  const procura = rProcura.ok ? await rProcura.json() : { users: [] };
  const jaExiste = (procura?.users ?? []).some(
    (u: { email?: string }) => (u.email ?? "").toLowerCase() === email,
  );

  let pin: string | null = null;

  if (!jaExiste) {
    // ── 4. Criar a conta pela API de administração ─────────────────────────
    pin = gerarPin();
    const password = await derivePassword(telefone, pin);

    const rCria = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE}`,
        apikey: SERVICE_ROLE,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        // profile_type explícito: sem ele o trigger handle_new_user usava o
        // valor por omissão e a conta nascia com papel errado.
        user_metadata: { name: nome, phone: telefone, profile_type: "client" },
      }),
    });

    if (!rCria.ok) {
      const detalhe = await rCria.text();
      console.error("[fleet-create-driver] admin/users falhou:", rCria.status, detalhe);
      return json({ error: "Não foi possível criar a conta do motorista" }, 502);
    }
  }

  // ── 5. Associar à frota ──────────────────────────────────────────────────
  // Com o JWT do chamador, de propósito: toda a autorização (dono da frota,
  // motorista já noutra frota, atribuição do papel `driver`) fica na RPC que
  // já existe e já está testada, em vez de ser reescrita aqui.
  const rAssoc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/add_driver_to_fleet`, {
    method: "POST",
    headers: comoChamador,
    body: JSON.stringify({ p_phone: telefone, p_name: nome, p_vehicle_type: veiculo }),
  });

  if (!rAssoc.ok) {
    const detalhe = await rAssoc.text();
    console.error("[fleet-create-driver] add_driver_to_fleet falhou:", rAssoc.status, detalhe);
    // A conta pode ter sido criada e a associação ter falhado (ex: o motorista
    // já pertence a outra frota). Diz-se o que aconteceu em vez de fingir êxito.
    let mensagem = "Conta criada, mas não foi possível associar à frota";
    try {
      const j = JSON.parse(detalhe);
      if (j?.message) mensagem = j.message;
    } catch { /* fica a mensagem genérica */ }
    return json({ error: mensagem, contaCriada: !jaExiste }, 400);
  }

  const driverId = await rAssoc.json();

  return json({ driverId, pin, jaTinhaConta: jaExiste, telefone });
});
