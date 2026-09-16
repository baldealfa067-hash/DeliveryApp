#!/usr/bin/env node
/**
 * FASE 9.3 — prova de entrega obrigatória (código OU foto), por HTTP real.
 *
 * A auditoria encontrou SEIS caminhos para concluir uma entrega, e só um exigia
 * prova. Este teste tenta TODOS sem prova e exige que falhem — é a parte que um
 * teste ingénuo deixava de fora, porque "o botão desapareceu" não prova nada
 * sobre as RPCs que continuam chamáveis por quem tiver um JWT.
 *
 * Depois prova as duas saídas legítimas (código e foto), o limite de
 * tentativas, que a foto continua a funcionar depois de o código bloquear, que
 * uma tentativa recusada NÃO lança nada no ledger, e quem pode ver a prova.
 *
 *   node scripts/prova-entrega-test.mjs
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
const BAIRRO = `ZonaProva${MARCA.slice(-6)}`;
const PRECO = 8000, TAXA = 1200;
// Uma imagem valida para o servidor: data:image/... com mais de 100 caracteres.
const FOTO = "data:image/jpeg;base64," + "iVBORw0KGgoAAAANSUhEUgAA".repeat(12);
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
  console.log(`\nFASE 9.3 — prova de entrega (${MARCA})\n\nPreparacao`);
  const dono = await signup("dono"), cliente = await signup("cliente"), estranho = await signup("estranho");
  const frota = await signup("frota"), motorista = await signup("motorista"), outraFrota = await signup("outrafrota");

  await rpc(dono.token, "register_as_business");
  const biz = (await tabela(dono.token, `profiles?select=id&user_id=eq.${dono.user_id}`)).corpo?.[0]?.id;
  const NOME = `Caldo ${MARCA}`;
  const item = (await tabela(dono.token, "menu_items", { method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ business_id: biz, name: NOME, price: PRECO }) })).corpo[0].id;

  await rpc(frota.token, "create_fleet", { p_name: `Frota ${MARCA}`, p_phone: `9${String(Date.now()).slice(-7)}` });
  await rpc(frota.token, "upsert_zone_price", { p_bairro: BAIRRO, p_preco: TAXA });
  await rpc(outraFrota.token, "create_fleet", { p_name: `Outra ${MARCA}`, p_phone: `9${String(Date.now() + 3).slice(-7)}` });
  const tel = `9${String(Date.now() + 7).slice(-7)}`;
  await tabela(motorista.token, `profiles?user_id=eq.${motorista.user_id}`, { method: "PATCH",
    headers: { Prefer: "return=minimal" }, body: JSON.stringify({ phone: tel }) });
  await rpc(frota.token, "add_driver_to_fleet", { p_phone: tel, p_name: "Motorista Prova" });
  await rpc(motorista.token, "toggle_driver_availability");

  // Um pedido a dinheiro levado ate `recolhido`.
  const novoPedido = async () => {
    const o = await rpc(cliente.token, "create_order", {
      p_business_id: biz, p_customer_id: cliente.user_id, p_customer_name: "Cliente", p_customer_phone: "955101010",
      p_items: [{ menu_item_id: item, name: NOME, price: PRECO, qty: 1 }], p_total: PRECO,
      p_consumption_option: "entrega", p_bairro: BAIRRO, p_address: "Perto do mercado", p_payment_method: "entrega" });
    const id = o.corpo;
    for (const e of ["confirmado", "em_preparacao", "pronto"])
      await rpc(dono.token, "update_order_status", { p_order_id: id, p_new_status: e });
    const entrega = (await tabela(dono.token, `deliveries?select=id&order_id=eq.${id}`)).corpo?.[0]?.id;
    await rpc(motorista.token, "accept_delivery", { p_delivery_id: entrega });
    await rpc(motorista.token, "pickup_delivery", { p_delivery_id: entrega });
    return { id, entrega };
  };
  const estado = async (id) => (await tabela(cliente.token, `orders?select=status&id=eq.${id}`)).corpo?.[0]?.status;
  const linhasLedger = async (id) => ((await tabela(dono.token, `ledger_entries?select=id&order_id=eq.${id}`)).corpo ?? []).length;

  const A = await novoPedido();
  A.entrega ? ok("pedido a dinheiro recolhido pelo motorista") : ko("montagem falhou");
  if (!A.entrega) return;

  // --- 1. os seis caminhos, SEM prova --------------------------------------
  console.log("\n1. Todos os caminhos sem prova tem de falhar");
  const c1 = await rpc(motorista.token, "complete_delivery", { p_delivery_id: A.entrega });
  c1.status >= 400 ? ok("complete_delivery sem prova: recusado", "era o botao 'Sem codigo'") : ko("CONCLUIU SEM PROVA via complete_delivery");

  const c2 = await rpc(motorista.token, "create_delivery_proof", { p_delivery_id: A.entrega, p_photo_url: "", p_qr_validated: true });
  c2.status >= 400 ? ok("qr_validated=true declarado pelo cliente: recusado", "o furo mais grave") : ko("ACEITOU qr_validated DO CLIENTE");
  (await estado(A.id)) !== "concluido" ? ok("... e o pedido NAO ficou concluido") : ko("o pedido ficou concluido pelo furo");

  const c3 = await rpc(motorista.token, "create_delivery_proof", { p_delivery_id: A.entrega, p_photo_url: "x" });
  c3.status >= 400 ? ok("'foto' que nao e imagem: recusada") : ko("aceitou lixo como fotografia");

  const c4 = await rpc(motorista.token, "update_order_status", { p_order_id: A.id, p_new_status: "concluido" });
  c4.status >= 400 ? ok("motorista via update_order_status: recusado") : ko("CONCLUIU SEM PROVA via update_order_status");

  const c5 = await rpc(dono.token, "update_order_status", { p_order_id: A.id, p_new_status: "concluido" });
  c5.status >= 400 ? ok("restaurante via update_order_status: recusado", "o fallback antigo fechou") : ko("RESTAURANTE CONCLUIU SEM PROVA");

  (await estado(A.id)) !== "concluido" ? ok("depois de 5 tentativas o pedido continua por concluir") : ko("concluido por algum caminho");
  (await linhasLedger(A.id)) === 0
    ? ok("ZERO linhas no ledger", "uma recusa nao lanca divida nem comissao")
    : ko("AS TENTATIVAS RECUSADAS LANCARAM NO LEDGER", `${await linhasLedger(A.id)}`);

  // --- 2. limite do codigo --------------------------------------------------
  console.log("\n2. Limite de tentativas do codigo");
  let falsos = 0;
  for (let i = 0; i < 5; i++) {
    const r = await rpc(motorista.token, "validate_delivery_code", { p_delivery_id: A.entrega, p_code: "000000" });
    if (r.corpo === false) falsos++;
  }
  falsos === 5 ? ok("5 codigos errados devolvem falso") : ko("respostas inesperadas", `${falsos}/5`);
  const codigoA = (await tabela(cliente.token, `orders?select=delivery_code&id=eq.${A.id}`)).corpo?.[0]?.delivery_code;
  const bloqueado = await rpc(motorista.token, "validate_delivery_code", { p_delivery_id: A.entrega, p_code: codigoA });
  bloqueado.status >= 400 && /bloqueado/i.test(erro(bloqueado))
    ? ok("ao 6o, bloqueado — MESMO com o codigo certo", "e manda usar a fotografia")
    : ko("o limite nao bloqueou", `HTTP ${bloqueado.status}`);

  // --- 3. a saida: foto depois do bloqueio -----------------------------------
  console.log("\n3. A fotografia continua a ser uma saida");
  const foto = await rpc(motorista.token, "create_delivery_proof", { p_delivery_id: A.entrega, p_photo_url: FOTO });
  foto.status < 300 ? ok("fotografia aceite") : ko("fotografia recusada", erro(foto));
  const fimA = await rpc(motorista.token, "complete_delivery", { p_delivery_id: A.entrega });
  fimA.status < 300 ? ok("com foto, complete_delivery conclui") : ko("nao concluiu com foto", erro(fimA));
  (await estado(A.id)) === "concluido" ? ok("pedido concluido") : ko("estado final errado", await estado(A.id));
  (await linhasLedger(A.id)) > 0 ? ok("so AGORA o ledger lancou", `${await linhasLedger(A.id)} linhas`) : ko("ledger vazio depois de concluir com prova");

  // --- 4. codigo certo, noutro pedido ----------------------------------------
  console.log("\n4. Codigo certo");
  const B = await novoPedido();
  const codigoB = (await tabela(cliente.token, `orders?select=delivery_code&id=eq.${B.id}`)).corpo?.[0]?.delivery_code;
  const val = await rpc(motorista.token, "validate_delivery_code", { p_delivery_id: B.entrega, p_code: codigoB });
  val.corpo === true ? ok("codigo certo valida e conclui") : ko("codigo certo recusado", erro(val));
  (await estado(B.id)) === "concluido" ? ok("pedido concluido") : ko("nao concluiu", await estado(B.id));

  // --- 5. quem ve a prova ----------------------------------------------------
  console.log("\n5. Quem pode ver a prova (§37, §46)");
  const verComo = (tok, id) => rpc(tok, "get_delivery_proof", { p_order_id: id });
  const pc = (await verComo(cliente.token, A.id)).corpo;
  pc?.existe && pc.tipo === "foto" && pc.foto ? ok("cliente ve a prova do seu pedido", "tipo: foto") : ko("cliente nao ve a prova", JSON.stringify(pc).slice(0, 120));
  (await verComo(cliente.token, B.id)).corpo?.tipo === "codigo" ? ok("e distingue prova por codigo") : ko("tipo de prova errado");
  (await verComo(dono.token, A.id)).corpo?.existe ? ok("restaurante ve a prova") : ko("restaurante nao ve");
  (await verComo(frota.token, A.id)).corpo?.existe ? ok("frota ve a prova, pela RPC", "a tabela continua fechada a frota") : ko("frota nao ve");
  (await verComo(motorista.token, A.id)).corpo?.existe ? ok("motorista ve a prova") : ko("motorista nao ve");

  const ve1 = await verComo(estranho.token, A.id);
  ve1.status >= 400 ? ok("outro cliente NAO ve", `HTTP ${ve1.status}`) : ko("ISOLAMENTO QUEBRADO: outro cliente viu a prova");
  const ve2 = await verComo(outraFrota.token, A.id);
  ve2.status >= 400 ? ok("outra frota NAO ve") : ko("ISOLAMENTO QUEBRADO: outra frota viu a prova");

  // A TABELA directamente — caminho diferente da RPC.
  const dirC = (await tabela(cliente.token, `delivery_proofs?select=id&order_id=eq.${A.id}`)).corpo ?? [];
  dirC.length === 1 ? ok("tabela directa: o cliente le a sua prova") : ko("tabela directa: cliente nao le", `${dirC.length}`);
  const dirE = (await tabela(estranho.token, `delivery_proofs?select=id&order_id=eq.${A.id}`)).corpo ?? [];
  dirE.length === 0 ? ok("tabela directa: outro cliente le ZERO") : ko("ISOLAMENTO QUEBRADO na tabela directa");
  const escrever = await tabela(motorista.token, "delivery_proofs", { method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ delivery_id: B.entrega, order_id: B.id, qr_validated: true }) });
  escrever.status >= 400 ? ok("ninguem escreve provas a mao", `HTTP ${escrever.status}`) : ko("PROVA FORJADA pela tabela");

  console.log(`\n  SQL de limpeza (privilegio de admin):\n    DELETE FROM auth.users WHERE email LIKE 'rlstest-%@deliveryapp.test';\n`);
}
main().catch((e) => ko("ERRO", e.message)).finally(() => {
  console.log(`\n${passou} passou, ${falhou} falhou\n`); process.exit(falhou > 0 ? 1 : 0); });
