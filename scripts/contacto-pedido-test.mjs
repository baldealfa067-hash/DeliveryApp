#!/usr/bin/env node
/**
 * Checkout e contacto (2026-09-17) — o cliente liga ao restaurante e ao motorista.
 *
 * `get_customer_orders` passou a devolver `business_phone`, `driver_name` e
 * `driver_phone`. O que este teste fixa é a JANELA do motorista: o número só
 * aparece enquanto ele está com o pedido, e desaparece fora dela (antes de
 * aceitar, e depois de o pedido terminar). E que isto não abriu `drivers`:
 * a tabela, lida directamente com o mesmo JWT, continua a devolver zero.
 *
 * Termina o pedido por CANCELAMENTO, não por conclusão, para não escrever no
 * ledger real (ver a nota de limpeza do ledger).
 *
 *   node scripts/contacto-pedido-test.mjs
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
const BAIRRO = `ZonaContacto${MARCA.slice(-6)}`;
const PRECO = 5000, TAXA = 1000;
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
  console.log(`\nContacto no pedido (${MARCA})\n\nPreparacao`);
  const dono = await signup("dono"), cliente = await signup("cliente"), estranho = await signup("estranho");
  const frota = await signup("frota"), motorista = await signup("motorista");

  await rpc(dono.token, "register_as_business");
  const telLoja = `9${String(Date.now() + 11).slice(-7)}`;
  const biz = (await tabela(dono.token, `profiles?select=id&user_id=eq.${dono.user_id}`)).corpo?.[0]?.id;
  await tabela(dono.token, `profiles?id=eq.${biz}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ phone: telLoja }) });
  const NOME = `Arroz ${MARCA}`;
  const item = (await tabela(dono.token, "menu_items", { method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ business_id: biz, name: NOME, price: PRECO }) })).corpo[0].id;

  await rpc(frota.token, "create_fleet", { p_name: `Frota ${MARCA}`, p_phone: `9${String(Date.now()).slice(-7)}` });
  await rpc(frota.token, "upsert_zone_price", { p_bairro: BAIRRO, p_preco: TAXA });
  const tel = `9${String(Date.now() + 7).slice(-7)}`;
  await tabela(motorista.token, `profiles?user_id=eq.${motorista.user_id}`, { method: "PATCH",
    headers: { Prefer: "return=minimal" }, body: JSON.stringify({ phone: tel }) });
  await rpc(frota.token, "add_driver_to_fleet", { p_phone: tel, p_name: "Motorista Contacto" });
  await rpc(motorista.token, "toggle_driver_availability");

  const novoPedido = async () => {
    const o = await rpc(cliente.token, "create_order", {
      p_business_id: biz, p_customer_id: cliente.user_id, p_customer_name: "Cliente", p_customer_phone: "955101010",
      p_items: [{ menu_item_id: item, name: NOME, price: PRECO, qty: 1 }], p_total: PRECO,
      p_consumption_option: "entrega", p_bairro: BAIRRO, p_address: "Perto do mercado", p_payment_method: "entrega" });
    return typeof o.corpo === "string" ? o.corpo : null;
  };
  const pronto = async (id) => {
    for (const e of ["confirmado", "em_preparacao", "pronto"])
      await rpc(dono.token, "update_order_status", { p_order_id: id, p_new_status: e });
    return (await tabela(dono.token, `deliveries?select=id&order_id=eq.${id}`)).corpo?.[0]?.id;
  };
  const verPedido = async (id) => {
    const r = await rpc(cliente.token, "get_customer_orders", { p_customer_id: cliente.user_id });
    return (r.corpo ?? []).find?.((x) => x.id === id);
  };

  const A = await novoPedido();
  A ? ok("pedido A criado") : ko("create_order falhou");
  if (!A) return;

  console.log("\n1. Restaurante: sempre");
  let p = await verPedido(A);
  p?.business_phone === telLoja ? ok("cliente recebe o telefone do restaurante") : ko("sem telefone do restaurante", JSON.stringify(p?.business_phone));
  p?.driver_phone == null && p?.driver_name == null ? ok("antes de haver motorista: sem telefone de motorista") : ko("telefone de motorista antes de aceitar");
  const entA = await pronto(A);
  p = await verPedido(A);
  p?.driver_phone == null ? ok("pedido pronto, ninguem aceitou: continua sem telefone", p?.status) : ko("telefone exposto sem motorista aceitar");

  console.log("\n2. Motorista: so enquanto esta com o pedido");
  const ac = await rpc(motorista.token, "accept_delivery", { p_delivery_id: entA });
  ac.status < 300 ? ok("motorista aceitou") : ko("accept_delivery falhou", erro(ac));
  p = await verPedido(A);
  p?.driver_phone === tel && p?.driver_name === "Motorista Contacto"
    ? ok("cliente ve nome e telefone do motorista", p.status) : ko("sem contacto do motorista", JSON.stringify([p?.status, p?.driver_name, p?.driver_phone]));

  console.log("\n3. Isolamento");
  const e1 = await rpc(estranho.token, "get_customer_orders", { p_customer_id: cliente.user_id });
  e1.status >= 400 ? ok("outro cliente NAO le os pedidos deste", `HTTP ${e1.status}`) : ko("ISOLAMENTO QUEBRADO: outro cliente leu", JSON.stringify(e1.corpo).slice(0, 120));
  const e2 = await rpc(estranho.token, "get_customer_orders", { p_customer_id: estranho.user_id });
  (e2.corpo ?? []).length === 0 ? ok("... e pelos seus proprios, ve zero") : ko("estranho ve pedidos que nao sao dele");
  const dC = (await tabela(cliente.token, `drivers?select=phone&phone=eq.${tel}`)).corpo ?? [];
  dC.length === 0 ? ok("tabela drivers directa: o cliente le ZERO", "so a RPC expoe, e so na janela") : ko("drivers ABERTA ao cliente", `${dC.length}`);
  const dE = (await tabela(estranho.token, `drivers?select=phone&phone=eq.${tel}`)).corpo ?? [];
  dE.length === 0 ? ok("tabela drivers directa: o estranho le ZERO") : ko("drivers ABERTA ao estranho");
  const anon = await fetch(`${URL_BASE}/rest/v1/rpc/get_customer_orders`, { method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_customer_id: cliente.user_id }) });
  anon.status >= 400 ? ok("anonimo nao chama a RPC", `HTTP ${anon.status}`) : ko("ANONIMO chamou get_customer_orders");

  console.log("\n4. Fora da janela: fecha");
  const cn = await rpc(dono.token, "update_order_status", { p_order_id: A, p_new_status: "cancelado", p_note: "teste contacto" });
  cn.status < 300 ? ok("pedido A cancelado com motorista atribuido (sem tocar no ledger)") : ko("cancelamento falhou", erro(cn));
  p = await verPedido(A);
  p?.status === "cancelado" && p?.driver_phone == null && p?.driver_name == null
    ? ok("cancelado: o telefone do motorista desaparece") : ko("TELEFONE CONTINUA VISIVEL fora da janela", JSON.stringify([p?.status, p?.driver_phone]));
  p?.business_phone === telLoja ? ok("o do restaurante continua") : ko("telefone do restaurante sumiu");

  console.log("\n5. A caminho: continua visivel");
  const B = await novoPedido();
  const entB = await pronto(B);
  await rpc(motorista.token, "accept_delivery", { p_delivery_id: entB });
  await rpc(motorista.token, "pickup_delivery", { p_delivery_id: entB });
  p = await verPedido(B);
  p?.status === "a_caminho" && p?.driver_phone === tel ? ok("recolhido e a caminho: cliente ainda liga ao motorista", p.status) : ko("desapareceu a caminho", JSON.stringify([p?.status, p?.driver_phone]));
  // B fica a_caminho: daqui so se conclui, e concluir escrevia no ledger real.

  // Apagar so auth.users falha: drivers -> fleets bloqueia. Ordem que funciona:
  console.log(`\n  Limpeza (privilegio de admin), por esta ordem, para os pedidos das contas ${MARCA}-%:
    dispatch_attempts, deliveries, order_status_history, orders (por order_id);
    drivers (por user_id); auth.users.  Sem ledger: o teste nunca conclui.\n`);
}
main().catch((e) => ko("ERRO", e.message)).finally(() => {
  console.log(`\n${passou} passou, ${falhou} falhou\n`); process.exit(falhou > 0 ? 1 : 0); });
