#!/usr/bin/env node
/**
 * FASE 7.1 — o modelo do envio, por HTTP real com JWT de utilizador normal.
 *
 * DUAS FASES, e a razao e' honesta: a RPC que cria envios so chega na 7.2, e a
 * unica policy de INSERT em `orders` e' a do admin. Para exercer o CHECK e as
 * regras de estado por HTTP -- e nao por SQL privilegiado, que nao provaria o
 * caminho real -- uma conta de teste tem de ter papel `admin`, e esse papel so
 * se atribui com privilegio.
 *
 *   1) node scripts/envio-modelo-test.mjs --fase=1
 *      cria as contas por HTTP e imprime a MARCA e o user_id do admin.
 *
 *   2) como admin (MCP/SQL):
 *        INSERT INTO public.user_roles (user_id, role)
 *        VALUES ('<user_id impresso>', 'admin') ON CONFLICT DO NOTHING;
 *
 *   3) node scripts/envio-modelo-test.mjs --fase=2 --marca=<MARCA>
 *      CHECK, colunas novas, cancelamento e isolamento. Imprime o envio que
 *      fica a espera de entrega.
 *
 *   4) como admin (MCP/SQL): criar a linha de `deliveries` desse envio.
 *      `deliveries` nao tem policy de INSERT para admin -- so as RPCs
 *      SECURITY DEFINER escrevem la -- e a RPC que o fara (create_send_order)
 *      so chega na 7.2. Por isso aqui a entrega e' fabricada, a modelar o que
 *      a 7.2 vai fazer: restaurant_address = o endereco de RECOLHA.
 *
 *   5) node scripts/envio-modelo-test.mjs --fase=3 --marca=<MARCA>
 *      o que o motorista ve, e o cancelamento tardio.
 *
 * O privilegio serve para dar o papel. Tudo o que se mede -- o CHECK, o
 * cancelamento, o isolamento, o que o motorista ve -- passa pela API publica
 * com o token de quem tem de o fazer.
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
const URL_BASE = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!URL_BASE || !ANON) { console.error("Faltam variaveis do Supabase"); process.exit(1); }

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const FASE = arg("fase") ?? "1";
const MARCA = arg("marca") ?? `rlstest-${Date.now()}`;
const SENHA = "TesteEnvio#2026";
const BAIRRO_DESTINO = `ZonaEnvio${MARCA.slice(-6)}`;

let passou = 0, falhou = 0;
const ok = (n, d = "") => { passou++; console.log(`  \x1b[32m✓\x1b[0m ${n}${d ? ` — ${d}` : ""}`); };
const ko = (n, d = "") => { falhou++; console.log(`  \x1b[31m✗\x1b[0m ${n}${d ? ` — ${d}` : ""}`); };

const email = (etq) => `${MARCA}-${etq}@deliveryapp.test`;
async function signup(etq) {
  const r = await fetch(`${URL_BASE}/auth/v1/signup`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: email(etq), password: SENHA, data: { name: etq } }),
  });
  const c = await r.json();
  if (!c.access_token) throw new Error(`signup ${etq}: ${JSON.stringify(c).slice(0, 200)}`);
  return { token: c.access_token, user_id: c.user.id };
}
async function login(etq) {
  const r = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: email(etq), password: SENHA }),
  });
  const c = await r.json();
  if (!c.access_token) throw new Error(`login ${etq}: ${JSON.stringify(c).slice(0, 200)}`);
  return { token: c.access_token, user_id: c.user.id };
}
const rpc = async (token, nome, args = {}) => {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${nome}`, {
    method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  let corpo = null; try { corpo = await r.json(); } catch { /* 204 */ }
  return { status: r.status, corpo };
};
const tabela = async (token, caminho, init = {}) => {
  const r = await fetch(`${URL_BASE}/rest/v1/${caminho}`, {
    ...init,
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  let corpo = null; try { corpo = await r.json(); } catch { /* vazio */ }
  return { status: r.status, corpo };
};
const erro = (r) => JSON.stringify(r.corpo?.message ?? r.corpo ?? "").slice(0, 170);

async function fase1() {
  console.log(`\nFASE 7.1 — preparacao (${MARCA})\n`);
  const cliente = await signup("cliente");
  await signup("outrocliente");
  const frota = await signup("frota");
  const motorista = await signup("motorista");
  await signup("outrafrota");
  const admin = await signup("admin");

  await rpc(frota.token, "create_fleet", { p_name: `Frota ${MARCA}`, p_phone: `9${String(Date.now()).slice(-7)}` });
  await rpc(frota.token, "upsert_zone_price", { p_bairro: BAIRRO_DESTINO, p_preco: 2500 });
  const outra = await login("outrafrota");
  await rpc(outra.token, "create_fleet", { p_name: `Outra ${MARCA}`, p_phone: `9${String(Date.now() + 3).slice(-7)}` });

  const tel = `9${String(Date.now() + 7).slice(-7)}`;
  await tabela(motorista.token, `profiles?user_id=eq.${motorista.user_id}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ phone: tel }),
  });
  await rpc(frota.token, "add_driver_to_fleet", { p_phone: tel, p_name: "Motorista Envio" });
  await rpc(motorista.token, "toggle_driver_availability");

  console.log("Contas criadas.\n");
  console.log(`  MARCA:    ${MARCA}`);
  console.log(`  cliente:  ${cliente.user_id}`);
  console.log(`  admin:    ${admin.user_id}`);
  console.log(`\n  Dar papel admin e depois correr a fase 2:`);
  console.log(`    INSERT INTO public.user_roles (user_id, role) VALUES ('${admin.user_id}', 'admin') ON CONFLICT DO NOTHING;`);
  console.log(`    node scripts/envio-modelo-test.mjs --fase=2 --marca=${MARCA}\n`);
}

async function fase2() {
  console.log(`\nFASE 7.1 — modelo do envio (${MARCA})\n`);
  const cliente = await login("cliente");
  const outroCliente = await login("outrocliente");
  const frota = await login("frota");
  const motorista = await login("motorista");
  const outraFrota = await login("outrafrota");
  const admin = await login("admin");

  const souAdmin = await rpc(admin.token, "has_role", { _user_id: admin.user_id, _role: "admin" });
  souAdmin.corpo === true ? ok("conta de teste tem papel admin") : ko("papel admin em falta — correu o INSERT do passo 2?");
  if (souAdmin.corpo !== true) return;

  const fleetId = (await tabela(frota.token, "fleets?select=id")).corpo?.[0]?.id;
  const outroFleetId = (await tabela(outraFrota.token, "fleets?select=id")).corpo?.[0]?.id;

  const envioBase = (extra = {}) => ({
    kind: "envio", business_id: null, consumption_option: "entrega", total: 0,
    status: "aguardando_motorista", customer_id: cliente.user_id,
    customer_name: "Cliente Envio", customer_phone: "955123456",
    bairro: BAIRRO_DESTINO, address: "Safim, casa azul depois da bomba",
    pickup_address: "Mercado de Bandim, banca do Sr. Mane",
    pickup_bairro: "Bandim",
    pickup_voice_note_url: `https://exemplo.test/${MARCA}-recolha.webm`,
    voice_note_url: `https://exemplo.test/${MARCA}-entrega.webm`,
    send_item_type: "documento",
    fleet_id: fleetId, delivery_fee: 2500,
    ...extra,
  });
  const criar = (extra) => tabela(admin.token, "orders", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify(envioBase(extra)),
  });

  // --- 1. O CHECK condicional, por HTTP ---------------------------------
  console.log("1. CHECK orders_kind_coerente");
  const bom = await criar({});
  const envioId = bom.corpo?.[0]?.id;
  envioId ? ok("envio valido aceite", `#${bom.corpo[0].order_number}`) : ko("envio valido recusado", erro(bom));
  if (!envioId) return;

  const comNegocio = await criar({ business_id: (await tabela(admin.token, "profiles?select=id&limit=1")).corpo?.[0]?.id });
  comNegocio.status >= 400 ? ok("envio COM restaurante recusado") : ko("aceitou envio com restaurante");

  const comTotal = await criar({ total: 5000 });
  comTotal.status >= 400
    ? ok("envio com total > 0 recusado", "protege o ledger de uma linha sem business_id")
    : ko("ACEITOU envio com total > 0", "o ledger rebentaria na conclusao");

  const semEntrega = await criar({ consumption_option: "para_levar" });
  semEntrega.status >= 400 ? ok("envio que nao e entrega recusado") : ko("aceitou envio 'para_levar'");

  const restSemNegocio = await tabela(admin.token, "orders", {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ...envioBase(), kind: "restaurante", business_id: null }),
  });
  restSemNegocio.status >= 400
    ? ok("pedido de RESTAURANTE sem restaurante recusado", "a porta que a coluna nullable abriria")
    : ko("ACEITOU pedido de restaurante sem business_id");

  const tipoMau = await criar({ send_item_type: "carro" });
  tipoMau.status >= 400 ? ok("send_item_type invalido recusado") : ko("aceitou send_item_type invalido");

  const kindMau = await criar({ kind: "mototaxi" });
  kindMau.status >= 400 ? ok("kind invalido recusado") : ko("aceitou kind invalido");

  // --- 2. Colunas novas --------------------------------------------------
  console.log("\n2. Colunas de origem e as duas vozes");
  const lido = (await tabela(cliente.token,
    `orders?select=kind,pickup_address,pickup_bairro,pickup_voice_note_url,voice_note_url,send_item_type,business_id&id=eq.${envioId}`)).corpo?.[0];
  lido?.kind === "envio" && lido?.business_id === null
    ? ok("o cliente le o seu envio (RLS por customer_id)")
    : ko("cliente nao ve o envio", JSON.stringify(lido));
  lido?.pickup_address?.includes("Bandim") && lido?.pickup_bairro === "Bandim"
    ? ok("origem gravada e lida", `"${lido.pickup_address}"`)
    : ko("origem perdida", JSON.stringify(lido));
  lido?.send_item_type === "documento" ? ok("tipo de envio gravado") : ko("tipo perdido");
  lido?.pickup_voice_note_url && lido?.voice_note_url &&
    lido.pickup_voice_note_url !== lido.voice_note_url
    ? ok("duas gravacoes de voz distintas (§21)", "recolha e entrega")
    : ko("as vozes nao sao duas", JSON.stringify(lido));

  // --- 3. Numeracao -------------------------------------------------------
  const segundo = await criar({});
  const n1 = bom.corpo[0].order_number, n2 = segundo.corpo?.[0]?.order_number;
  n2 && n1 !== n2 ? ok("dois envios, numeros distintos", `#${n1} e #${n2}`) : ko("numeros repetidos", `${n1} / ${n2}`);

  // --- 4. A regra de estado nova -----------------------------------------
  console.log("\n3. Cancelamento de um envio (regra nova)");
  const cancela = await rpc(cliente.token, "update_order_status", {
    p_order_id: envioId, p_new_status: "cancelado",
  });
  cancela.status < 300
    ? ok("cliente cancela o envio em `aguardando_motorista`", "antes da 7.1 era impossivel")
    : ko("cliente NAO conseguiu cancelar o envio", erro(cancela));

  const estado = (await tabela(cliente.token, `orders?select=status&id=eq.${envioId}`)).corpo?.[0]?.status;
  estado === "cancelado" ? ok("o estado ficou `cancelado`") : ko("estado errado", estado);

  console.log(`\n  ENVIO a espera de entrega: ${segundo.corpo[0].id}`);
  console.log(`  Criar a entrega (admin) e depois correr a fase 3.`);

  // --- 4. A regra do restaurante nao mudou -------------------------------
  console.log("\n4. Regressao: a regra antiga do restaurante");
  const terceiro = await criar({});
  const tercId = terceiro.corpo?.[0]?.id;
  const comoRestaurante = await tabela(admin.token, `orders?id=eq.${tercId}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "novo" }),
  });
  const cancelaNovo = await rpc(cliente.token, "update_order_status", {
    p_order_id: tercId, p_new_status: "cancelado",
  });
  cancelaNovo.status < 300
    ? ok("um envio em `novo` tambem se cancela", "os dois estados permitidos")
    : ko("nao cancelou em `novo`", erro(cancelaNovo));

  // --- 5. Isolamento ------------------------------------------------------
  console.log("\n5. Isolamento (§46)");
  const aberto = segundo.corpo[0].id;   // o envio que fica para a fase 3

  const alheio = await tabela(outroCliente.token, `orders?select=id&id=eq.${aberto}`);
  (alheio.corpo ?? []).length === 0
    ? ok("outro cliente nao ve o envio", `HTTP ${alheio.status}`)
    : ko("ISOLAMENTO QUEBRADO: viu o envio alheio");

  const cancelaAlheio = await rpc(outroCliente.token, "update_order_status", {
    p_order_id: aberto, p_new_status: "cancelado",
  });
  cancelaAlheio.status >= 400
    ? ok("outro cliente nao cancela o envio alheio")
    : ko("ISOLAMENTO QUEBRADO: cancelou envio alheio");

  const criarSemAdmin = await tabela(cliente.token, "orders", {
    method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(envioBase()),
  });
  criarSemAdmin.status >= 400
    ? ok("cliente comum nao cria envios a mao", `HTTP ${criarSemAdmin.status} — so por RPC (7.2)`)
    : ko("QUALQUER UM CRIA ENVIOS directamente");

  console.log(`\n  SQL de limpeza (privilegio de admin):`);
  console.log(`    DELETE FROM auth.users WHERE email LIKE 'rlstest-%@deliveryapp.test';\n`);
}

async function fase3() {
  console.log(`\nFASE 7.1 — o motorista e o envio (${MARCA})\n`);
  const cliente = await login("cliente");
  const motorista = await login("motorista");
  const outraFrota = await login("outrafrota");
  const admin = await login("admin");

  // Localiza o envio que ficou a espera -- sem passar ids a mao entre fases.
  const alvo = (await tabela(admin.token,
    `orders?select=id,order_number&kind=eq.envio&status=eq.aguardando_motorista&customer_id=eq.${cliente.user_id}&order=created_at.desc&limit=1`)).corpo?.[0];
  alvo?.id ? ok("envio encontrado", `#${alvo.order_number}`) : ko("nao encontrei o envio a espera");
  if (!alvo?.id) return;

  const entrega = (await tabela(admin.token, `deliveries?select=id,restaurant_address&order_id=eq.${alvo.id}`)).corpo?.[0];
  entrega?.id
    ? ok("entrega existe", `recolha: "${entrega.restaurant_address}"`)
    : ko("a entrega nao foi criada — correu o passo 4?");
  if (!entrega?.id) return;

  console.log("\n1. O motorista ve um envio (Fase 7.0, agora com dados reais)");
  const disp = await rpc(motorista.token, "get_available_deliveries");
  const linha = (disp.corpo ?? []).find((d) => d.order_id === alvo.id);
  linha
    ? ok("motorista da frota VE o envio", "sem restaurante nenhum por tras")
    : ko("O MOTORISTA NAO VE O ENVIO", "o LEFT JOIN da 7.0 nao chegou");
  linha && linha.restaurant_name === entrega.restaurant_address
    ? ok("no lugar do nome do restaurante aparece o ponto de recolha", `"${linha.restaurant_name}"`)
    : ko("nome de recolha inesperado", String(linha?.restaurant_name));

  const dispOutra = await rpc(outraFrota.token, "get_available_deliveries");
  ((dispOutra.corpo ?? []).filter((d) => d.order_id === alvo.id)).length === 0
    ? ok("outra frota nao ve o envio (§46)")
    : ko("ISOLAMENTO QUEBRADO entre frotas");

  console.log("\n2. Depois de o motorista aceitar");
  const aceitar = await rpc(motorista.token, "accept_delivery", { p_delivery_id: entrega.id });
  aceitar.status < 300 ? ok("motorista aceita o envio") : ko("accept_delivery falhou", erro(aceitar));

  const minhas = await rpc(motorista.token, "get_my_deliveries");
  ((minhas.corpo ?? []).filter((d) => d.order_id === alvo.id)).length === 1
    ? ok("o envio aparece em `get_my_deliveries`", "a outra funcao que a 7.0 desarmou")
    : ko("o envio desapareceu depois de aceite");

  const tardeDemais = await rpc(cliente.token, "update_order_status", {
    p_order_id: alvo.id, p_new_status: "cancelado",
  });
  tardeDemais.status >= 400 && /nenhum motorista o aceitou/.test(erro(tardeDemais))
    ? ok("o cliente ja NAO cancela", "o compromisso passou a ser de dois lados")
    : ko("cancelou depois de o motorista aceitar", `HTTP ${tardeDemais.status}`);

  console.log(`\n  SQL de limpeza (privilegio de admin):`);
  console.log(`    DELETE FROM auth.users WHERE email LIKE 'rlstest-%@deliveryapp.test';\n`);
}

(FASE === "1" ? fase1() : FASE === "3" ? fase3() : fase2())
  .catch((err) => ko("ERRO", err.message))
  .finally(() => {
    if (FASE !== "1") console.log(`\n${passou} passou, ${falhou} falhou\n`);
    process.exit(falhou > 0 ? 1 : 0);
  });
