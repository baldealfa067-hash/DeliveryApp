#!/usr/bin/env node
/**
 * Dados de teste para a auditoria de layout (scripts/layout-audit.mjs), criados
 * em PRODUCAO pela API publica com a chave anon -- nunca service_role.
 *
 * Tudo marcado `layouttest-<ts>`, e isolado dos dados reais:
 *  - o restaurante fica SEM categoria -> nao aparece na lista publica
 *    (/inicio filtra `category != ''`), mas abre por /loja/<id>;
 *  - a frota so serve bairros FICTICIOS -> nenhum pedido real e encaminhado
 *    para ela (get_delivery_price casa pelo nome exacto do bairro);
 *  - uma entrega so e oferecida aos motoristas da frota do pedido.
 *
 * Nomes compridos de proposito (restaurante, pratos, cliente, frota): o que se
 * mede e o que acontece quando o texto nao cabe.
 *
 * O pedido A e levado ate `concluido` -- ESCREVE NO LEDGER real. A limpeza e
 * impressa no fim e tem de correr depois da auditoria (ver ledger-test-cleanup).
 *
 * Escreve scripts/.layout-dados.json (ignorado pelo git: tem a palavra-passe).
 *
 *   node scripts/layout-dados-teste.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const env = { ...process.env };
try {
  for (const l of readFileSync(".env", "utf8").split("\n")) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch { /* opcional */ }
const URL_BASE = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!URL_BASE || !ANON) { console.error("Faltam variaveis do Supabase"); process.exit(1); }

const MARCA = `layouttest-${Date.now()}`;
const PASS = "LayoutTeste#2026";
const ZONA1 = `Chapa de Bissau Zona Teste ${Date.now() % 10000}`;
const ZONA2 = `Bairro Militar Teste ${Date.now() % 10000}`;

// Uma voz a serio (7s de tom), para o leitor mostrar duracao. Sem ffmpeg serve
// qualquer coisa: o que se mede e o layout do leitor, nao o som.
let AUDIO = Buffer.from("voz-de-teste");
try {
  const f = join(tmpdir(), `${MARCA}.webm`);
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=7", "-c:a", "libopus", "-b:a", "24k", f]);
  if (existsSync(f)) AUDIO = readFileSync(f);
} catch { /* sem ffmpeg */ }

const cab = (tok) => ({ apikey: ANON, Authorization: `Bearer ${tok ?? ANON}` });
const rpc = async (tok, nome, args = {}) => {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${nome}`, { method: "POST",
    headers: { ...cab(tok), "Content-Type": "application/json" }, body: JSON.stringify(args) });
  let corpo = null; try { corpo = await r.json(); } catch { /* 204 */ }
  if (r.status >= 400) throw new Error(`${nome}: HTTP ${r.status} ${JSON.stringify(corpo).slice(0, 200)}`);
  return corpo;
};
const tabela = async (tok, caminho, init = {}) => {
  const r = await fetch(`${URL_BASE}/rest/v1/${caminho}`, { ...init,
    headers: { ...cab(tok), "Content-Type": "application/json", ...(init.headers ?? {}) } });
  let corpo = null; try { corpo = await r.json(); } catch { /* vazio */ }
  if (r.status >= 400) throw new Error(`${caminho}: HTTP ${r.status} ${JSON.stringify(corpo).slice(0, 200)}`);
  return corpo;
};
const conta = async (etq, meta = {}) => {
  const email = `${MARCA}-${etq}@deliveryapp.test`;
  const r = await fetch(`${URL_BASE}/auth/v1/signup`, { method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASS, data: { name: etq, ...meta } }) });
  const c = await r.json();
  if (!c.access_token) throw new Error(`signup ${etq}: ${JSON.stringify(c).slice(0, 200)}`);
  return { token: c.access_token, user_id: c.user.id, email };
};
const enviarVoz = async (u, pasta) => {
  const nome = `${u.user_id}/${pasta}/${Date.now()}-layout.webm`;
  const r = await fetch(`${URL_BASE}/storage/v1/object/notas-voz/${nome}`, { method: "POST",
    headers: { ...cab(u.token), "Content-Type": "audio/webm" }, body: AUDIO });
  if (!r.ok) throw new Error(`upload voz: HTTP ${r.status} ${(await r.text()).slice(0, 150)}`);
  return nome;
};

const cliente = await conta("cliente", { name: "Maria Fernanda Gomes da Silva Cá", phone: "955123456" });
const dono = await conta("dono");
const frota = await conta("frota");
const mot1 = await conta("motorista1");
const mot2 = await conta("motorista2");

// Restaurante (sem categoria: fora da lista publica)
await rpc(dono.token, "register_as_business");
const biz = (await tabela(dono.token, `profiles?select=id&user_id=eq.${dono.user_id}`))[0].id;
await tabela(dono.token, `profiles?user_id=eq.${dono.user_id}`, { method: "PATCH",
  headers: { Prefer: "return=minimal" },
  body: JSON.stringify({
    name: "Restaurante Sabores Tradicionais da Guiné-Bissau",
    description: "Comida caseira guineense: caldo de mancarra, caldo branco, peixe grelhado e sumos naturais de baobá e fole.",
    phone: "966804992", location: "Bairro Militar", lat: 11.8636, lng: -15.5977,
    profile_type: "business", consumption_options: ["comer_no_local", "para_levar", "entrega"],
    prep_time_minutes: 35,
  }) });
const cats = await tabela(dono.token, "menu_categories", { method: "POST", headers: { Prefer: "return=representation" },
  body: JSON.stringify([
    { business_id: biz, name: "Pratos Tradicionais da Casa" },
    { business_id: biz, name: "Bebidas e Sumos Naturais" },
  ]) });
const itens = await tabela(dono.token, "menu_items", { method: "POST", headers: { Prefer: "return=representation" },
  body: JSON.stringify([
    { business_id: biz, category_id: cats[0].id, name: "Caldo de Mancarra com Arroz Branco e Frango do Campo", price: 3500 },
    { business_id: biz, category_id: cats[0].id, name: "Peixe Bica Grelhado com Batata-Doce e Salada Tropical", price: 6500 },
    { business_id: biz, category_id: cats[0].id, name: "Cachupa", price: 2500 },
    { business_id: biz, category_id: cats[1].id, name: "Sumo de Baobá (Cabaceira) Natural 1 Litro", price: 1250 },
    { business_id: biz, category_id: cats[1].id, name: "Água", price: 500 },
  ]) });
await rpc(dono.token, "set_menu_item_stock", { p_menu_item_id: itens[2].id, p_stock_qty: 12 });
await rpc(dono.token, "set_business_location_voice", { p_business_id: biz, p_ref: await enviarVoz(dono, "negocio/localizacao") });

// Frota (so bairros ficticios) + motoristas
await rpc(frota.token, "create_fleet", { p_name: "Frota Rápida Bissau Transportes e Entregas", p_phone: `95${String(Date.now()).slice(-7)}`, p_bairro: null });
await rpc(frota.token, "upsert_zone_price", { p_bairro: ZONA1, p_preco: 1500 });
await rpc(frota.token, "upsert_zone_price", { p_bairro: ZONA2, p_preco: 12500 });
for (const [i, m, nome] of [[1, mot1, "Aliu Mamadu Baldé Djaló"], [2, mot2, "Fatumata Binta Embaló"]]) {
  const t = `96${String(Date.now() + i).slice(-7)}`;
  await tabela(m.token, `profiles?user_id=eq.${m.user_id}`, { method: "PATCH",
    headers: { Prefer: "return=minimal" }, body: JSON.stringify({ phone: t }) });
  await rpc(frota.token, "add_driver_to_fleet", { p_phone: t, p_name: nome });
}
await rpc(mot1.token, "toggle_driver_availability");

// Pedidos do cliente de teste no restaurante de teste, um por estado
const item = (i, q) => ({ menu_item_id: itens[i].id, name: itens[i].name, price: itens[i].price, qty: q });
const soma = (xs) => xs.reduce((s, x) => s + x.price * x.qty, 0);
const criar = async (xs, extra) => rpc(cliente.token, "create_order", {
  p_business_id: biz, p_customer_id: cliente.user_id,
  p_customer_name: "Maria Fernanda Gomes da Silva Cá", p_customer_phone: "955123456",
  p_items: xs, p_total: soma(xs), p_payment_method: "entrega", ...extra,
});
const entrega = async (xs, zona) => criar(xs, {
  p_consumption_option: "entrega", p_bairro: zona,
  p_address: `${zona} - Casa amarela depois da escola primária, portão verde ao lado da farmácia`,
  p_customer_lat: 11.8701, p_customer_lng: -15.6012, p_voice_note_url: await enviarVoz(cliente, "orders/voice"),
  p_notes: "Sem picante, por favor. Ligar quando chegar ao portão.",
});
const estados = async (id, sts) => { for (const s of sts) await rpc(dono.token, "update_order_status", { p_order_id: id, p_new_status: s }); };
const entregaDe = async (id) => (await tabela(dono.token, `deliveries?select=id&order_id=eq.${id}`))[0]?.id;

const pA = await entrega([item(0, 2), item(3, 2)], ZONA1);          // concluido
await estados(pA, ["confirmado", "em_preparacao", "pronto"]);
const dA = await entregaDe(pA);
await rpc(mot1.token, "accept_delivery", { p_delivery_id: dA });
await rpc(mot1.token, "pickup_delivery", { p_delivery_id: dA });
const codA = (await tabela(cliente.token, `orders?select=delivery_code&id=eq.${pA}`))[0].delivery_code;
await rpc(mot1.token, "validate_delivery_code", { p_delivery_id: dA, p_code: codA });

const pB = await entrega([item(1, 1), item(2, 3), item(4, 2)], ZONA1); // a caminho
await estados(pB, ["confirmado", "em_preparacao", "pronto"]);
const dB = await entregaDe(pB);
await rpc(mot1.token, "accept_delivery", { p_delivery_id: dB });
await rpc(mot1.token, "pickup_delivery", { p_delivery_id: dB });

const pC = await entrega([item(0, 1)], ZONA2);                       // oferecido, por aceitar
await estados(pC, ["confirmado", "em_preparacao", "pronto"]);
const pD = await criar([item(2, 1), item(3, 1)], { p_consumption_option: "para_levar", p_notes: "Vou buscar às 13h" }); // novo
const pE = await criar([item(1, 2)], { p_consumption_option: "comer_no_local" });            // em preparacao
await estados(pE, ["confirmado", "em_preparacao"]);
const pF = await criar([item(4, 1)], { p_consumption_option: "para_levar" });                 // cancelado pelo cliente
await rpc(cliente.token, "update_order_status", { p_order_id: pF, p_new_status: "cancelado" });
const pG = await entrega([item(3, 4)], ZONA2);                       // confirmado
await estados(pG, ["confirmado"]);

// Fecho de caixa: a frota declara parte da comida do pedido A
await rpc(frota.token, "declare_cash_settlement", { p_business_id: biz, p_amount: 5000, p_dia: new Date().toISOString().slice(0, 10), p_note: "Entregue em mão ao gerente" });

// Horario com dois periodos por dia (depois dos pedidos, para nao travar a criacao)
const horario = [];
for (let d = 0; d < 7; d++) horario.push({ weekday: d, opens_at: "00:00", closes_at: "15:00" }, { weekday: d, opens_at: "15:30", closes_at: "23:59" });
await rpc(dono.token, "set_business_hours", { p_business_id: biz, p_horario: horario });

const dados = {
  marca: MARCA, pass: PASS, biz, zonas: [ZONA1, ZONA2],
  contas: { cliente: cliente.email, dono: dono.email, frota: frota.email, motorista1: mot1.email, motorista2: mot2.email },
  pedidos: { pA, pB, pC, pD, pE, pF, pG },
};
writeFileSync("scripts/.layout-dados.json", JSON.stringify(dados, null, 2));
console.log(`Dados criados (${MARCA}) -> scripts/.layout-dados.json`);
console.log(`\nLIMPEZA depois da auditoria (o pedido A escreveu no ledger; ver memoria ledger-test-cleanup):`);
console.log(`  marca: ${MARCA} -- apagar pela ordem das chaves estrangeiras, com salvaguarda que aborta`);
console.log(`  se aparecer pedido, ledger ou motorista que nao seja desta marca. Ficheiros de voz saem pela`);
console.log(`  Storage API (storage.protect_delete recusa SQL).`);
