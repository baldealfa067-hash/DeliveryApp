#!/usr/bin/env node
/**
 * Entrega SEM coordenadas GPS — decisao do dono do projecto de 2026-09-16.
 *
 * A entrega tem de EXISTIR e ser despachada a frota mesmo sem GPS de nenhum dos
 * lados. A distancia fica NULL, nunca 0 (§40: nao apresentar estimativas como
 * se fossem precisas).
 *
 * O QUE ESTE TESTE PROTEGE, e que um teste ingenuo deixaria passar: a formula
 * de haversine com NULLs NAO rebenta nem devolve NULL -- `GREATEST(-1.0, NULL)`
 * em Postgres ignora o NULL, da -1.0, e `acos(-1.0)` = pi, portanto a
 * "distancia" sairia 20.015 km com ar perfeitamente credivel. Por isso aqui
 * nao se verifica so' que a entrega existe: verifica-se que `distance_km` e'
 * mesmo NULL e nao um numero inventado.
 *
 *   node scripts/alertas-entrega-sem-gps-test.mjs
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

const MARCA = `rlstest-${Date.now()}`;
const BAIRRO = `ZonaSemGps${Date.now() % 100000}`;
let passou = 0, falhou = 0;
const ok = (n, d = "") => { passou++; console.log(`  \x1b[32m✓\x1b[0m ${n}${d ? ` — ${d}` : ""}`); };
const ko = (n, d = "") => { falhou++; console.log(`  \x1b[31m✗\x1b[0m ${n}${d ? ` — ${d}` : ""}`); };

async function signup(etiqueta) {
  const r = await fetch(`${URL_BASE}/auth/v1/signup`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: `${MARCA}-${etiqueta}@deliveryapp.test`, password: "TesteAlertas#2026", data: { name: etiqueta } }),
  });
  const c = await r.json();
  if (!c.access_token) throw new Error(`signup ${etiqueta}: ${JSON.stringify(c)}`);
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

async function main() {
  console.log(`\nEntrega sem GPS (${MARCA})\n`);
  console.log("Preparacao");

  const dono = await signup("dono");
  const cliente = await signup("cliente");
  const frota = await signup("frota");
  const motorista = await signup("motorista");

  await rpc(dono.token, "register_as_business");
  const perfil = (await tabela(dono.token, `profiles?select=id,lat,lng&user_id=eq.${dono.user_id}`)).corpo?.[0];
  if (!perfil?.id) throw new Error("sem perfil de restaurante");
  const biz = perfil.id;

  // O ponto do teste: NINGUEM tem coordenadas. Nem restaurante nem cliente.
  perfil.lat == null && perfil.lng == null
    ? ok("restaurante sem lat/lng")
    : ko("restaurante trazia coordenadas", JSON.stringify(perfil));

  const NOME = `Arroz de peixe ${MARCA}`;
  const item = (await tabela(dono.token, "menu_items", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ business_id: biz, name: NOME, price: 4000 }),
  })).corpo[0].id;

  const telFrota = `9${String(Date.now()).slice(-7)}`;
  await rpc(frota.token, "create_fleet", { p_name: `Frota ${MARCA}`, p_phone: telFrota });
  await rpc(frota.token, "upsert_zone_price", { p_bairro: BAIRRO, p_preco: 2000 });

  const telMot = `9${String(Date.now() + 11).slice(-7)}`;
  await tabela(motorista.token, `profiles?user_id=eq.${motorista.user_id}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ phone: telMot }),
  });
  await rpc(frota.token, "add_driver_to_fleet", { p_phone: telMot, p_name: "Motorista Teste" });
  const disp = await rpc(motorista.token, "toggle_driver_availability");
  disp.corpo === true ? ok("frota com 1 motorista disponivel") : ko("motorista nao ficou disponivel");

  // Pedido de entrega SEM p_customer_lat/p_customer_lng.
  const ord = await rpc(cliente.token, "create_order", {
    p_business_id: biz, p_customer_id: cliente.user_id,
    p_customer_name: "Cliente Teste", p_customer_phone: "955000777",
    p_items: [{ menu_item_id: item, name: NOME, price: 4000, qty: 1 }],
    p_total: 4000, p_consumption_option: "entrega", p_bairro: BAIRRO,
    p_address: "Casa azul depois da bomba, perguntar por Ndala",
    p_payment_method: "entrega",
  });
  const pedidoId = typeof ord.corpo === "string" ? ord.corpo : null;
  pedidoId
    ? ok("pedido de entrega ACEITE sem GPS", "nao foi recusado no checkout")
    : ko("create_order recusou o pedido sem GPS", JSON.stringify(ord.corpo).slice(0, 200));
  if (!pedidoId) return;

  for (const estado of ["confirmado", "em_preparacao", "pronto"]) {
    const r = await rpc(dono.token, "update_order_status", { p_order_id: pedidoId, p_new_status: estado });
    if (r.status >= 400) ko(`transicao para ${estado}`, JSON.stringify(r.corpo).slice(0, 160));
  }

  // --- 1. a entrega existe -------------------------------------------------
  console.log("\n1. A entrega existe apesar de nao haver coordenadas");
  const est = (await tabela(dono.token, `orders?select=status&id=eq.${pedidoId}`)).corpo?.[0]?.status;
  est === "aguardando_motorista"
    ? ok("o pedido avancou para `aguardando_motorista`", "antes ficava preso em `pronto`")
    : ko("o pedido nao avancou", `ficou em ${est}`);

  const ent = (await tabela(dono.token,
    `deliveries?select=id,status,fleet_id,delivery_fee,distance_km,restaurant_lat,customer_lat,customer_address&order_id=eq.${pedidoId}`)).corpo?.[0];
  ent?.id ? ok("linha em `deliveries` criada") : ko("NAO HA ENTREGA — a correccao nao pegou");
  if (!ent?.id) return;

  // --- 2. a distancia e NULL, nao um numero inventado ---------------------
  console.log("\n2. Distancia");
  ent.distance_km === null
    ? ok("`distance_km` e NULL", "§40: nao se inventa o que nao se mediu")
    : ko("DISTANCIA INVENTADA", `distance_km = ${ent.distance_km} (o acos(-1.0) da ~20015)`);
  ent.restaurant_lat === null && ent.customer_lat === null
    ? ok("as coordenadas ficaram a NULL, sem valores de enchimento")
    : ko("apareceram coordenadas do nada", JSON.stringify({ r: ent.restaurant_lat, c: ent.customer_lat }));
  (ent.customer_address ?? "").includes("perguntar por Ndala")
    ? ok("a morada por referencia local sobreviveu (§78)", `"${ent.customer_address}"`)
    : ko("morada perdida", JSON.stringify(ent.customer_address));

  // --- 3. foi mesmo despachada --------------------------------------------
  console.log("\n3. Dispatch");
  ent.fleet_id ? ok("entrega atribuida a frota", `taxa ${ent.delivery_fee} FCFA`) : ko("entrega sem frota", JSON.stringify(ent));

  const rondas = (await tabela(dono.token,
    `dispatch_attempts?select=attempt_number,outcome,drivers_notified&order_id=eq.${pedidoId}`)).corpo ?? [];
  rondas.length === 1 && rondas[0].outcome === "pendente" && rondas[0].drivers_notified === 1
    ? ok("1 ronda aberta, 1 motorista notificado", "entra no ciclo normal de expiracao")
    : ko("ronda de dispatch inesperada", JSON.stringify(rondas));

  const disponiveis = await rpc(motorista.token, "get_available_deliveries");
  (disponiveis.corpo ?? []).some((d) => d.order_id === pedidoId)
    ? ok("o motorista da frota ve a entrega")
    : ko("o motorista nao ve a entrega", JSON.stringify(disponiveis.corpo ?? []).slice(0, 200));

  // --- 4. o motorista consegue trabalhar sem GPS --------------------------
  console.log("\n4. O motorista consegue executar a entrega");
  const aceitar = await rpc(motorista.token, "accept_delivery", { p_delivery_id: ent.id });
  aceitar.status < 300 ? ok("motorista aceitou") : ko("accept_delivery falhou", JSON.stringify(aceitar.corpo).slice(0, 160));

  const hist = (await tabela(dono.token, `order_status_history?select=note&order_id=eq.${pedidoId}`)).corpo ?? [];
  hist.some((h) => /Sem coordenadas: distancia nao calculada/.test(h.note ?? ""))
    ? ok("o historico regista porque nao ha distancia (§74)")
    : ko("historico sem a nota da distancia", JSON.stringify(hist.map((h) => h.note)).slice(0, 200));

  // --- 5. a rede de seguranca nao dispara falsos positivos ---------------
  console.log("\n5. alert_stuck_orders continua so para casos reais");
  const presos = ((await rpc(dono.token, "get_my_notifications", { p_limit: 200 })).corpo ?? [])
    .filter((n) => n.type === "pedido_preso" && n.reference_id === pedidoId);
  presos.length === 0
    ? ok("este pedido NAO foi marcado como preso", "tem entrega, logo nao e caso dela")
    : ko("FALSO POSITIVO da rede de seguranca", JSON.stringify(presos.map((n) => n.title)));

  // O `create_delivery` legado deixou de ser chamavel.
  const legado = await rpc(dono.token, "create_delivery", {
    p_order_id: pedidoId, p_restaurant_lat: null, p_restaurant_lng: null,
    p_restaurant_address: "x", p_customer_lat: null, p_customer_lng: null,
    p_customer_address: "x", p_distance_km: null,
  });
  legado.status >= 400
    ? ok("`create_delivery` legado sem EXECUTE", `HTTP ${legado.status}`)
    : ko("o caminho legado ainda e chamavel", `HTTP ${legado.status}`);

  console.log(`\n  SQL de limpeza (privilegio de admin):`);
  console.log(`    DELETE FROM auth.users WHERE email LIKE 'rlstest-%@deliveryapp.test';\n`);
}

main()
  .catch((err) => ko("ERRO", err.message))
  .finally(() => {
    console.log(`\n${passou} passou, ${falhou} falhou\n`);
    process.exit(falhou > 0 ? 1 : 0);
  });
