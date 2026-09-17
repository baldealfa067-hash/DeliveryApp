#!/usr/bin/env node
/**
 * Checkout, ponto 3 (2026-09-17) — o restaurante escolhe como recebe por Orange Money.
 *
 * Por HTTP real com JWT de utilizador normal. Fixa:
 *  - o cliente recebe SÓ o valor do método escolhido (codigo / numero / nenhum);
 *  - a base recusa um método sem o valor correspondente (CHECK);
 *  - a coluna nova é privada: ninguém a lê pela tabela, nem o próprio dono;
 *  - outro restaurante não altera o método deste;
 *  - a gravação do perfil, feita como o browser a faz (PATCH + representação).
 *
 *   node scripts/orange-money-metodo-test.mjs
 */
import { readFileSync } from "node:fs";

function lerEnv() {
  const env = { ...process.env };
  try {
    for (const l of readFileSync(".env", "utf8").split("\n")) {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* opcional */ }
  return env;
}
const env = lerEnv();
const URL_BASE = env.VITE_SUPABASE_URL, ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!URL_BASE || !ANON) { console.error("Faltam variaveis do Supabase"); process.exit(1); }

const MARCA = `rlstest-${Date.now()}`;
let passou = 0, falhou = 0;
const ok = (n, d = "") => { passou++; console.log(`  \x1b[32m✓\x1b[0m ${n}${d ? ` — ${d}` : ""}`); };
const ko = (n, d = "") => { falhou++; console.log(`  \x1b[31m✗\x1b[0m ${n}${d ? ` — ${d}` : ""}`); };
async function signup(etq) {
  const r = await fetch(`${URL_BASE}/auth/v1/signup`, { method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: `${MARCA}-${etq}@deliveryapp.test`, password: "TesteProva#2026", data: { name: etq } }) });
  const c = await r.json();
  if (!c.access_token) throw new Error(`signup ${etq}: ${JSON.stringify(c).slice(0, 200)}`);
  return { token: c.access_token, user_id: c.user.id };
}
const rpc = async (tok, nome, args = {}) => {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${nome}`, { method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: JSON.stringify(args) });
  let corpo = null; try { corpo = await r.json(); } catch { /* 204 */ }
  return { status: r.status, corpo };
};
const tabela = async (tok, caminho, init = {}) => {
  const r = await fetch(`${URL_BASE}/rest/v1/${caminho}`, { ...init,
    headers: { apikey: ANON, Authorization: `Bearer ${tok}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  let corpo = null; try { corpo = await r.json(); } catch { /* vazio */ }
  return { status: r.status, corpo };
};
const erro = (r) => JSON.stringify(r.corpo?.message ?? r.corpo ?? "").slice(0, 160);

async function main() {
  console.log(`\nOrange Money: metodo escolhido pelo restaurante (${MARCA})\n\nPreparacao`);
  const dono = await signup("dono"), cliente = await signup("cliente"), outro = await signup("outro");
  await rpc(dono.token, "register_as_business");
  await rpc(outro.token, "register_as_business");
  const biz = (await tabela(dono.token, `profiles?select=id&user_id=eq.${dono.user_id}`)).corpo?.[0]?.id;
  biz ? ok("restaurante criado") : ko("sem perfil de restaurante");
  if (!biz) return;

  const CODIGO = "#144#32*123456#", NUMERO = "955123456";
  // Exactamente o pedido do BusinessEdit: .update(body).eq("id").select().single()
  // Antes pedia select=* e a gravacao inteira falhava com 403 desde que as colunas
  // privadas fecharam (2026-09-10). Agora pede so as publicas, como o formulario.
  const COLS = "id,user_id,name,category,description,location,photo_url,phone,lat,lng,profile_type,is_verified,verification_status,verification_submitted_at,consumption_options,prep_time_minutes,price_type,services,starting_price,bornaal_id,created_at,updated_at";
  const gravar = (tok, corpo) => tabela(tok, `profiles?id=eq.${biz}&select=${COLS}`, { method: "PATCH",
    headers: { Prefer: "return=representation", Accept: "application/vnd.pgrst.object+json" }, body: JSON.stringify(corpo) });
  const verComoCliente = async () => (await rpc(cliente.token, "get_business_payment_info", { p_business_id: biz })).corpo?.[0];

  console.log("\n0. Gravacao do perfil como o browser a faz");
  const g0 = await gravar(dono.token, { name: `Loja ${MARCA}`, merchant_code: CODIGO, payment_number: NUMERO, orange_money_method: "codigo" });
  g0.status < 300 ? ok("PATCH com as colunas publicas grava", `HTTP ${g0.status}`) : ko("PATCH do formulario FALHA", `HTTP ${g0.status} ${erro(g0)}`);
  // Mesmo que a representacao falhe, confirmar o que ficou gravado, pela RPC do dono.
  const priv = async () => (await rpc(dono.token, "get_my_profile_private")).corpo?.[0];
  (await priv())?.orange_money_method === "codigo" ? ok("gravado: metodo = codigo") : ko("metodo nao ficou gravado", JSON.stringify(await priv()));

  console.log("\n1. O cliente ve so o metodo escolhido");
  let v = await verComoCliente();
  v?.merchant_code === CODIGO && v?.payment_number == null ? ok("codigo: recebe o codigo, NAO o numero") : ko("codigo: resposta errada", JSON.stringify(v));

  const pn = await tabela(dono.token, `profiles?id=eq.${biz}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ orange_money_method: "numero" }) });
  pn.status < 300 ? ok("dono troca para numero") : ko("troca recusada", erro(pn));
  v = await verComoCliente();
  v?.payment_number === NUMERO && v?.merchant_code == null ? ok("numero: recebe o numero, NAO o codigo") : ko("numero: resposta errada", JSON.stringify(v));
  (await priv())?.merchant_code === CODIGO ? ok("o codigo continua guardado", "trocar nao apaga o outro") : ko("trocar apagou o codigo");

  await tabela(dono.token, `profiles?id=eq.${biz}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ orange_money_method: null }) });
  v = await verComoCliente();
  v?.merchant_code == null && v?.payment_number == null ? ok("nenhum: o cliente nao recebe nada", "so dinheiro na entrega") : ko("nenhum: ainda sai um valor", JSON.stringify(v));

  console.log("\n2. A base recusa incoerencias (CHECK)");
  const c1 = await tabela(dono.token, `profiles?id=eq.${biz}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ orange_money_method: "codigo", merchant_code: null }) });
  c1.status >= 400 ? ok("codigo sem codigo: recusado", `HTTP ${c1.status}`) : ko("ACEITOU codigo sem codigo");
  const c2 = await tabela(dono.token, `profiles?id=eq.${biz}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ orange_money_method: "numero", payment_number: "  " }) });
  c2.status >= 400 ? ok("numero em branco: recusado", `HTTP ${c2.status}`) : ko("ACEITOU numero em branco");
  const c3 = await tabela(dono.token, `profiles?id=eq.${biz}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ orange_money_method: "pix" }) });
  c3.status >= 400 ? ok("metodo inventado: recusado", `HTTP ${c3.status}`) : ko("ACEITOU metodo inventado");

  console.log("\n3. Privacidade e isolamento");
  await tabela(dono.token, `profiles?id=eq.${biz}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ orange_money_method: "codigo" }) });
  const d1 = await tabela(cliente.token, `profiles?select=orange_money_method&id=eq.${biz}`);
  d1.status >= 400 ? ok("cliente NAO le a coluna pela tabela", `HTTP ${d1.status}`) : ko("coluna LEGIVEL pelo cliente", JSON.stringify(d1.corpo));
  const d2 = await tabela(cliente.token, `profiles?select=merchant_code&id=eq.${biz}`);
  d2.status >= 400 ? ok("cliente continua sem ler merchant_code pela tabela") : ko("merchant_code LEGIVEL pela tabela");
  const pubAnon = await fetch(`${URL_BASE}/rest/v1/rpc/get_business_payment_info`, { method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_business_id: biz }) });
  pubAnon.status >= 400 ? ok("anonimo nao chama get_business_payment_info", `HTTP ${pubAnon.status}`) : ko("ANONIMO leu os dados de pagamento");
  const mine = (await rpc(cliente.token, "get_my_profile_private")).corpo ?? [];
  !mine.some((r) => r.merchant_code === CODIGO) ? ok("get_my_profile_private do cliente nao devolve os do restaurante") : ko("VAZAMENTO em get_my_profile_private");
  const o1 = await tabela(outro.token, `profiles?id=eq.${biz}`, { method: "PATCH", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ orange_money_method: "numero" }) });
  (await priv())?.orange_money_method === "codigo" ? ok("outro restaurante NAO troca o metodo deste", `HTTP ${o1.status}, ${(o1.corpo ?? []).length ?? 0} linhas`) : ko("ISOLAMENTO QUEBRADO: outro restaurante mudou o metodo");

  console.log(`\n  Limpeza (admin): DELETE FROM auth.users WHERE email LIKE '${MARCA}-%@deliveryapp.test';\n`);
}
main().catch((e) => ko("ERRO", e.message)).finally(() => {
  console.log(`\n${passou} passou, ${falhou} falhou\n`); process.exit(falhou > 0 ? 1 : 0); });
