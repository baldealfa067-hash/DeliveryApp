#!/usr/bin/env node
/**
 * Checkout, ponto 4 (2026-09-17) — comprovativo Orange Money obrigatório, imposto
 * no servidor (create_order), por HTTP real com JWT de cliente.
 *
 * O ecrã já não deixa avançar sem comprovativo, mas o ecrã não é a autoridade
 * (§46): quem tiver um JWT chama a RPC directamente. Por isso o teste tenta TODAS
 * as formas de passar sem comprovativo verdadeiro e exige que falhem:
 *   restaurante sem Orange Money, sem comprovativo, texto solto, URL de fora,
 *   ficheiro que não existe, ficheiro de OUTRO cliente, ficheiro fora da pasta de
 *   comprovativos. Depois os dois caminhos legítimos.
 *
 * Limpa no fim os ficheiros que enviou (pela API, com o JWT do dono de cada um).
 *
 *   node scripts/comprovativo-obrigatorio-test.mjs
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
const PRECO = 3000;
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

// PNG 1x1 valido.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const enviados = [];
async function enviarImagem(conta, caminho) {
  const r = await fetch(`${URL_BASE}/storage/v1/object/portfolio/${caminho}`, { method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${conta.token}`, "Content-Type": "image/png" }, body: PNG });
  if (r.status < 300) enviados.push({ conta, caminho });
  return { status: r.status, url: `${URL_BASE}/storage/v1/object/public/portfolio/${caminho}` };
}

async function main() {
  console.log(`\nComprovativo obrigatorio (${MARCA})\n\nPreparacao`);
  const dono = await signup("dono"), donoSemOM = await signup("donosemom");
  const cliente = await signup("cliente"), outroCliente = await signup("outrocliente");

  const montarLoja = async (conta, comOM) => {
    await rpc(conta.token, "register_as_business");
    const id = (await tabela(conta.token, `profiles?select=id&user_id=eq.${conta.user_id}`)).corpo?.[0]?.id;
    await tabela(conta.token, `profiles?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify(comOM
        ? { name: `Loja ${MARCA}`, consumption_options: ["entrega"], merchant_code: "#144#32*999#", orange_money_method: "codigo" }
        : { name: `SemOM ${MARCA}`, consumption_options: ["entrega"] }) });
    const item = (await tabela(conta.token, "menu_items", { method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ business_id: id, name: `Prato ${MARCA}`, price: PRECO }) })).corpo?.[0]?.id;
    return { id, item };
  };
  const L = await montarLoja(dono, true), S = await montarLoja(donoSemOM, false);
  L.item && S.item ? ok("duas lojas: uma com Orange Money, outra sem") : ko("montagem das lojas falhou");

  const pedir = (conta, loja, metodo, comprovativo) => rpc(conta.token, "create_order", {
    p_business_id: loja.id, p_customer_id: conta.user_id, p_customer_name: "Cliente", p_customer_phone: "955101010",
    p_items: [{ menu_item_id: loja.item, name: `Prato ${MARCA}`, price: PRECO, qty: 1 }], p_total: PRECO,
    p_consumption_option: "entrega", p_bairro: "Nenhum", p_address: "Perto", p_payment_method: metodo,
    p_payment_proof_url: comprovativo });

  const bom = await enviarImagem(cliente, `${cliente.user_id}/orders/payment/${Date.now()}-a.png`);
  const doOutro = await enviarImagem(outroCliente, `${outroCliente.user_id}/orders/payment/${Date.now()}-b.png`);
  const foraDaPasta = await enviarImagem(cliente, `${cliente.user_id}/${Date.now()}-galeria.png`);
  bom.status < 300 && doOutro.status < 300 && foraDaPasta.status < 300
    ? ok("imagens reais enviadas para o storage", "com o JWT de cada cliente") : ko("upload falhou", `${bom.status}/${doOutro.status}/${foraDaPasta.status}`);

  console.log("\n1. Tudo o que NAO e comprovativo verdadeiro tem de falhar");
  const casos = [
    ["restaurante sem Orange Money (com comprovativo bom)", () => pedir(cliente, S, "online", bom.url), /nao recebe por Orange Money/],
    ["sem comprovativo", () => pedir(cliente, L, "online", null), /Anexe o comprovativo/],
    ["comprovativo em branco", () => pedir(cliente, L, "online", "   "), /Anexe o comprovativo/],
    ["texto solto ('x')", () => pedir(cliente, L, "online", "x"), /nao foi encontrado/],
    ["URL de fora do storage", () => pedir(cliente, L, "online", "https://example.com/pago.png"), /nao foi encontrado/],
    ["ficheiro que nao existe na pasta do cliente", () => pedir(cliente, L, "online", `${URL_BASE}/storage/v1/object/public/portfolio/${cliente.user_id}/orders/payment/inventado.png`), /nao foi encontrado/],
    ["comprovativo REAL de outro cliente", () => pedir(cliente, L, "online", doOutro.url), /nao foi encontrado/],
    ["imagem do proprio cliente fora da pasta de comprovativos", () => pedir(cliente, L, "online", foraDaPasta.url), /nao foi encontrado/],
  ];
  for (const [nome, f, msg] of casos) {
    const r = await f();
    r.status >= 400 && msg.test(erro(r)) ? ok(nome, "recusado") : ko(`${nome}: NAO recusado como esperado`, `HTTP ${r.status} ${erro(r)}`);
  }
  const contar = async () => ((await rpc(cliente.token, "get_customer_orders", { p_customer_id: cliente.user_id })).corpo ?? []).length;
  (await contar()) === 0 ? ok("zero pedidos criados pelas tentativas recusadas") : ko("uma tentativa recusada criou pedido");

  console.log("\n2. Os caminhos legitimos");
  const on = await pedir(cliente, L, "online", bom.url);
  on.status < 300 ? ok("Orange Money com comprovativo verdadeiro: aceite") : ko("pedido legitimo recusado", erro(on));
  const ent = await pedir(cliente, S, "entrega", bom.url);
  ent.status < 300 ? ok("pagar na entrega, restaurante sem Orange Money: aceite") : ko("pedido na entrega recusado", erro(ent));
  const pedidos = (await rpc(cliente.token, "get_customer_orders", { p_customer_id: cliente.user_id })).corpo ?? [];
  const pOn = pedidos.find((p) => p.id === on.corpo), pEnt = pedidos.find((p) => p.id === ent.corpo);
  pOn?.payment_method === "online" && pOn?.payment_proof_url === bom.url ? ok("pedido online guarda o comprovativo") : ko("comprovativo nao guardado", JSON.stringify(pOn?.payment_proof_url));
  pEnt?.payment_method === "entrega" && pEnt?.payment_proof_url == null ? ok("pedido na entrega NAO guarda comprovativo", "mesmo que o ecra o envie") : ko("pedido na entrega guardou comprovativo", JSON.stringify(pEnt?.payment_proof_url));

  // Limpeza dos ficheiros, pela API, cada um com o JWT do seu dono.
  let apagados = 0;
  for (const { conta, caminho } of enviados) {
    const r = await fetch(`${URL_BASE}/storage/v1/object/portfolio/${caminho}`, { method: "DELETE",
      headers: { apikey: ANON, Authorization: `Bearer ${conta.token}` } });
    if (r.status < 300) apagados++;
  }
  apagados === enviados.length ? ok("ficheiros de teste apagados do storage", `${apagados}`) : ko("ficaram ficheiros no storage", `${apagados}/${enviados.length}`);

  console.log(`\n  Limpeza (admin), para as contas ${MARCA}-%: order_status_history, order_items, orders (por order_id); auth.users.\n`);
}
main().catch((e) => ko("ERRO", e.message)).finally(() => {
  console.log(`\n${passou} passou, ${falhou} falhou\n`); process.exit(falhou > 0 ? 1 : 0); });
