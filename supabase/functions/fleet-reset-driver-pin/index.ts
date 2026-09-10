/**
 * fleet-reset-driver-pin — a frota gera um PIN novo para um motorista seu.
 *
 * PORQUE EXISTE: o PIN devolvido por `fleet-create-driver` e' mostrado uma vez
 * e nao fica guardado em lado nenhum recuperavel -- e' derivado, nao armazenado.
 * Se a frota fechar o ecra sem o anotar, ou se o motorista o esquecer, a unica
 * saida e' gerar outro. Sem isto, a conta ficava inutilizavel.
 *
 * PORQUE E' UMA FUNCAO SEPARADA de fleet-create-driver: criar e repor sao
 * operacoes diferentes com riscos diferentes. Meter as duas atras de um campo
 * `action` daria a uma funcao chamada "create-driver" o poder de mudar
 * passwords de contas existentes -- um nome que mente sobre o que a funcao faz
 * e' um problema de seguranca por si so'.
 *
 * A password segue o mesmo contrato de src/lib/clientAuth.ts, com o vector
 * partilhado fixado em clientAuth.test.ts. Se divergir, o motorista fica de
 * fora da propria conta.
 *
 * AUTORIZACAO, em tres verificacoes, todas explicitas:
 *   0. quem chama (auth.uid a partir do JWT)
 *   1. existe frota com owner_user_id = esse utilizador
 *   2. o motorista pertence A ESSA frota
 *
 * A primeira versao tinha so' 1 e 2, e 1 perguntava "que frota consigo ver"
 * em vez de "que frota e' minha". Nao chegava: a policy de SELECT em `fleets`
 * deixa um MOTORISTA ver a frota do patrao, e "Drivers manage own profile"
 * deixa-o ler a sua propria linha -- portanto passava nas duas e repunha o
 * proprio PIN, que e' o acesso administrativo que §12 lhe nega. Foi apanhado
 * num teste HTTP com o JWT do motorista, nao por leitura do codigo: as duas
 * verificacoes PARECIAM suficientes.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const SALT = "deliveryapp:client:v1";

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
  const comoChamador = { Authorization: auth, apikey: ANON_KEY, "Content-Type": "application/json" };

  let corpo: { driverId?: string };
  try {
    corpo = await req.json();
  } catch {
    return json({ error: "Corpo inválido" }, 400);
  }

  const driverId = (corpo.driverId ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(driverId)) return json({ error: "Motorista inválido" }, 400);

  // ── 0. Quem chama? ───────────────────────────────────────────────────────
  const rUser = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: comoChamador });
  if (!rUser.ok) return json({ error: "Sessão inválida" }, 401);
  const utilizador = await rUser.json();
  if (!utilizador?.id) return json({ error: "Sessão inválida" }, 401);

  // ── 1. Quem chama é DONO de que frota? ───────────────────────────────────
  // Filtrado por owner_user_id, e não por "a primeira frota que eu consiga
  // ver". A policy de SELECT em `fleets` deixa um MOTORISTA ver a frota dele:
  // sem este filtro, um motorista passava aqui com a frota do patrão e, como
  // também lê a sua própria linha de `drivers` ("Drivers manage own profile"),
  // passava na verificação 2 e repunha o próprio PIN — o acesso administrativo
  // que §12 lhe nega. Apanhado num teste HTTP com o JWT do motorista; as duas
  // verificações pareciam suficientes e não eram.
  const rFrota = await fetch(
    `${SUPABASE_URL}/rest/v1/fleets?owner_user_id=eq.${utilizador.id}&select=id&limit=1`,
    { headers: comoChamador },
  );
  if (!rFrota.ok) return json({ error: "Não foi possível confirmar a frota" }, 500);
  const frotas = await rFrota.json();
  const minhaFrota = Array.isArray(frotas) && frotas.length > 0 ? frotas[0].id : null;
  if (!minhaFrota) return json({ error: "Só o dono de uma frota pode repor PINs" }, 403);

  // ── 2. O motorista é DESSA frota? ────────────────────────────────────────
  const rDrv = await fetch(
    `${SUPABASE_URL}/rest/v1/drivers?id=eq.${driverId}&fleet_id=eq.${minhaFrota}&select=id,user_id,phone,name`,
    { headers: comoChamador },
  );
  if (!rDrv.ok) return json({ error: "Não foi possível confirmar o motorista" }, 500);
  const motoristas = await rDrv.json();
  if (!Array.isArray(motoristas) || motoristas.length === 0) {
    return json({ error: "Este motorista não pertence à sua frota" }, 403);
  }
  const motorista = motoristas[0];
  if (!motorista.user_id) return json({ error: "Motorista sem conta associada" }, 400);

  const telefone = normalizePhone(motorista.phone ?? "");
  if (telefone.length < 7) return json({ error: "Motorista sem telefone válido" }, 400);

  // ── 3. Gerar e aplicar ───────────────────────────────────────────────────
  const pin = gerarPin();
  const password = await derivePassword(telefone, pin);

  const rUpd = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${motorista.user_id}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE}`,
      apikey: SERVICE_ROLE,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password }),
  });

  if (!rUpd.ok) {
    const detalhe = await rUpd.text();
    console.error("[fleet-reset-driver-pin] admin update falhou:", rUpd.status, detalhe);
    return json({ error: "Não foi possível alterar o PIN" }, 502);
  }

  return json({ pin, telefone, nome: motorista.name ?? null });
});
