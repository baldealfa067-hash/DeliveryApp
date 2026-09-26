#!/usr/bin/env node
/**
 * Cancelamento pelo cliente (2026-09-26) — auditoria da regra que JÁ existe.
 *
 * `update_order_status` deixa o cliente cancelar:
 *   - um pedido de restaurante só em `novo` (antes de o restaurante confirmar);
 *   - um envio em `novo` ou `aguardando_motorista` (antes de um motorista aceitar).
 *
 * Este teste fixa as duas janelas pelos dois lados — o que passa e o que é
 * recusado — e o que o cancelamento arrasta consigo: o stock volta, a entrega
 * sai da lista do motorista. Tudo por HTTP com JWT normal, nunca `service_role`.
 *
 * Nenhum pedido é concluído: o ledger real não é tocado.
 *
 *   node scripts/cancelamento-cliente-test.mjs
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
const BAIRRO = `ZonaCancel${MARCA.slice(-6)}`;
const PRECO = 5000, TAXA = 1000, STOCK = 10;
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
  console.log(`\nCancelamento pelo cliente (${MARCA})\n\nPreparacao`);
  const dono = await signup("dono"), cliente = await signup("cliente"), estranho = await signup("estranho");
  const frota = await signup("frota"), motorista = await signup("motorista");

  await rpc(dono.token, "register_as_business");
  const biz = (await tabela(dono.token, `profiles?select=id&user_id=eq.${dono.user_id}`)).corpo?.[0]?.id;
  const NOME = `Arroz ${MARCA}`;
  const item = (await tabela(dono.token, "menu_items", { method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ business_id: biz, name: NOME, price: PRECO }) })).corpo[0].id;
  const st = await rpc(dono.token, "set_menu_item_stock", { p_menu_item_id: item, p_stock_qty: STOCK, p_track: true, p_motivo: "teste" });
  st.status < 300 ? ok("restaurante com stock", `${STOCK}`) : ko("set_menu_item_stock falhou", erro(st));

  await rpc(frota.token, "create_fleet", { p_name: `Frota ${MARCA}`, p_phone: `9${String(Date.now()).slice(-7)}` });
  await rpc(frota.token, "upsert_zone_price", { p_bairro: BAIRRO, p_preco: TAXA });
  const tel = `9${String(Date.now() + 7).slice(-7)}`;
  await tabela(motorista.token, `profiles?user_id=eq.${motorista.user_id}`, { method: "PATCH",
    headers: { Prefer: "return=minimal" }, body: JSON.stringify({ phone: tel }) });
  await rpc(frota.token, "add_driver_to_fleet", { p_phone: tel, p_name: "Motorista Cancel" });
  await rpc(motorista.token, "toggle_driver_availability");

  const stock = async () =>
    (await tabela(dono.token, `menu_items?select=stock_qty&id=eq.${item}`)).corpo?.[0]?.stock_qty;
  const novoPedido = async () => {
    const o = await rpc(cliente.token, "create_order", {
      p_business_id: biz, p_customer_id: cliente.user_id, p_customer_name: "Cliente", p_customer_phone: "955101010",
      p_items: [{ menu_item_id: item, name: NOME, price: PRECO, qty: 2 }], p_total: PRECO * 2,
      p_consumption_option: "entrega", p_bairro: BAIRRO, p_address: "Perto do mercado", p_payment_method: "entrega" });
    return typeof o.corpo === "string" ? o.corpo : null;
  };
  const estado = async (id) =>
    (await rpc(cliente.token, "get_customer_orders", { p_customer_id: cliente.user_id })).corpo?.find?.((x) => x.id === id)?.status;
  const cancelar = (tok, id) => rpc(tok, "update_order_status", { p_order_id: id, p_new_status: "cancelado", p_note: "teste" });

  // --- 1. restaurante: em novo -----------------------------------------
  console.log("\n1. Pedido de restaurante, ainda em `novo`");
  const A = await novoPedido();
  A ? ok("pedido A criado") : ko("create_order falhou");
  if (!A) return;
  const depoisDeCriar = await stock();
  // O stock das encomendas da app desconta na criacao? Regista-se o que acontece,
  // para a devolucao ser medida contra o valor real e nao contra um palpite.
  console.log(`    (stock depois de criar: ${depoisDeCriar})`);
  const eA = await cancelar(estranho.token, A);
  eA.status >= 400 ? ok("um ESTRANHO nao cancela o pedido de outro", erro(eA)) : ko("ESTRANHO CANCELOU um pedido alheio");
  (await estado(A)) === "novo" ? ok("... e o pedido continua em novo") : ko("o pedido mudou de estado");
  const cA = await cancelar(cliente.token, A);
  cA.status < 300 ? ok("o cliente cancela em `novo`") : ko("cancelamento em novo RECUSADO", erro(cA));
  (await estado(A)) === "cancelado" ? ok("estado = cancelado") : ko("estado nao mudou");
  (await stock()) === STOCK ? ok("o stock voltou ao que era", `${STOCK}`) : ko("stock nao voltou", `${await stock()}`);
  const outraVez = await cancelar(cliente.token, A);
  outraVez.status >= 400 ? ok("cancelar duas vezes e recusado (terminal)") : ko("cancelou um cancelado");

  // --- 2. restaurante: depois de confirmar ----------------------------
  console.log("\n2. Pedido de restaurante, depois de o restaurante confirmar");
  const B = await novoPedido();
  await rpc(dono.token, "update_order_status", { p_order_id: B, p_new_status: "confirmado" });
  const cB = await cancelar(cliente.token, B);
  cB.status >= 400 ? ok("o cliente ja NAO cancela em `confirmado`", erro(cB)) : ko("CLIENTE CANCELOU depois de confirmado");
  (await estado(B)) === "confirmado" ? ok("... e continua confirmado") : ko("estado mudou");
  await cancelar(dono.token, B); // arrumar: o restaurante ainda pode

  // --- 3. envio: antes de um motorista aceitar ------------------------
  console.log("\n3. Envio, a espera de motorista");
  const ENVIO = {
    p_send_item_type: "documento", p_description: "Envelope", p_pickup_address: "Mercado de Bandim",
    p_pickup_bairro: "Bandim", p_pickup_voice_note_url: null, p_bairro: BAIRRO,
    p_customer_name: "Cliente Envio", p_customer_phone: "955123456", p_voice_note_url: null,
    p_pickup_lat: null, p_pickup_lng: null, p_customer_lat: null, p_customer_lng: null, p_payment_method: "entrega",
  };
  const c1 = await rpc(cliente.token, "create_send_order", { ...ENVIO, p_address: "Casa azul 1" });
  const E1 = c1.corpo?.order_id;
  E1 ? ok("envio 1 criado", c1.corpo.status ?? "") : ko("create_send_order falhou", erro(c1));
  if (!E1) return;
  (await estado(E1)) === "aguardando_motorista" ? ok("nasce em aguardando_motorista") : ko("estado inicial inesperado", await estado(E1));
  const oferta = (await rpc(motorista.token, "get_available_deliveries")).corpo ?? [];
  oferta.some((d) => d.order_id === E1) ? ok("o motorista ve a oferta") : ko("o motorista nao ve a oferta");
  const cE1 = await cancelar(cliente.token, E1);
  cE1.status < 300 ? ok("o cliente cancela o envio antes de alguem aceitar") : ko("cancelamento do envio RECUSADO", erro(cE1));
  const oferta2 = (await rpc(motorista.token, "get_available_deliveries")).corpo ?? [];
  !oferta2.some((d) => d.order_id === E1) ? ok("a oferta desaparece da lista do motorista") : ko("MOTORISTA AINDA VE um envio cancelado");

  // --- 4. envio: depois de um motorista aceitar -----------------------
  console.log("\n4. Envio, depois de um motorista aceitar");
  const c2 = await rpc(cliente.token, "create_send_order", { ...ENVIO, p_address: "Casa azul 2" });
  const E2 = c2.corpo?.order_id;
  const ent2 = ((await rpc(motorista.token, "get_available_deliveries")).corpo ?? []).find((d) => d.order_id === E2)?.id;
  const ac = await rpc(motorista.token, "accept_delivery", { p_delivery_id: ent2 });
  ac.status < 300 ? ok("motorista aceitou o envio 2") : ko("accept_delivery falhou", erro(ac));
  const cE2 = await cancelar(cliente.token, E2);
  cE2.status >= 400 ? ok("o cliente ja NAO cancela depois de o motorista aceitar", erro(cE2)) : ko("CLIENTE CANCELOU com motorista a caminho");
  (await estado(E2)) === "motorista_encontrado" ? ok("... e continua com o motorista") : ko("estado mudou", await estado(E2));

  console.log(`\n  Limpeza (privilegio de admin), por esta ordem, para os pedidos das contas ${MARCA}-%:
    dispatch_attempts, deliveries, order_status_history, stock_adjustments, orders;
    menu_items, drivers, fleet_zone_prices, fleets; auth.users.  Sem ledger: nada foi concluido.\n`);
}
main().catch((e) => ko("ERRO", e.message)).finally(() => {
  console.log(`\n${passou} passou, ${falhou} falhou\n`); process.exit(falhou > 0 ? 1 : 0); });
