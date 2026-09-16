#!/usr/bin/env node
/**
 * FASE 2.2 — guarda de regressao: um pedido de entrega SEM GPS tem de ser
 * despachado na mesma, e NAO pode ser marcado como preso.
 *
 * HISTORIA DESTE FICHEIRO, que explica porque ele testa o contrario do que
 * testava. Na versao original media-se o cenario avariado: um restaurante sem
 * lat/lng recebia um pedido de entrega, o `update_order_status` nao criava
 * linha em `deliveries` (exigia coordenadas dos dois lados para a distancia) e
 * o pedido ficava parado em `pronto` -- invisivel a todas as frotas e invisivel
 * ao `expire_stale_dispatch`, que faz JOIN a `deliveries`. O
 * `alert_stuck_orders` foi construido para romper esse silencio.
 *
 * DECISAO DO DONO DO PROJECTO (2026-09-16): o cenario deixou de ser legitimo. A
 * entrega passa a existir com ou sem GPS -- a indicacao de voz e' o mecanismo
 * real de navegacao (§21) e recusar por falta de coordenadas deixava sem
 * servico quem nao da permissao de localizacao. Logo este teste passou a ser a
 * GUARDA DE REGRESSAO dessa decisao.
 *
 * O `alert_stuck_orders` NAO foi removido: fica como rede de seguranca para
 * qualquer outro motivo de bloqueio. O que este teste exige dele e' o oposto de
 * antes -- que NAO dispare aqui, porque um falso positivo por pedido de
 * entrega ensinaria o dono a ignorar o aviso. Que ele ainda DISPARA quando ha
 * mesmo um pedido sem entrega verifica-se por injeccao de falha, descrita no
 * fim deste ficheiro.
 *
 *   node scripts/alertas-preso-test.mjs
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
let passou = 0, falhou = 0;
const ok = (n, d = "") => { passou++; console.log(`  \x1b[32m✓\x1b[0m ${n}${d ? ` — ${d}` : ""}`); };
const ko = (n, d = "") => { falhou++; console.log(`  \x1b[31m✗\x1b[0m ${n}${d ? ` — ${d}` : ""}`); };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const hora = () => new Date().toTimeString().slice(0, 8);

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
const presosDe = async (c) =>
  ((await rpc(c.token, "get_my_notifications", { p_limit: 200 })).corpo ?? []).filter((n) => n.type === "pedido_preso");

async function main() {
  console.log(`\nFASE 2.2 — pedido preso sem entrega (${MARCA})\n`);

  const dono = await signup("dono");
  const cliente = await signup("cliente");
  await rpc(dono.token, "register_as_business");
  const biz = (await tabela(dono.token, `profiles?select=id,lat,lng&user_id=eq.${dono.user_id}`)).corpo?.[0];
  if (!biz?.id) throw new Error("sem perfil de restaurante");

  // O ponto do teste: restaurante SEM coordenadas. E' o estado por omissao.
  biz.lat == null && biz.lng == null
    ? ok("restaurante sem lat/lng, como sai do registo")
    : ko("perfil ja trazia coordenadas", JSON.stringify(biz));

  const NOME = `Caldo ${MARCA}`;
  const item = (await tabela(dono.token, "menu_items", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ business_id: biz.id, name: NOME, price: 2500 }),
  })).corpo[0].id;

  const ord = await rpc(cliente.token, "create_order", {
    p_business_id: biz.id, p_customer_id: cliente.user_id,
    p_customer_name: "Cliente Teste", p_customer_phone: "955000666",
    p_items: [{ menu_item_id: item, name: NOME, price: 2500, qty: 1 }],
    p_total: 2500, p_consumption_option: "entrega",
    p_address: "Perto do mercado", p_payment_method: "entrega",
    p_customer_lat: 11.87, p_customer_lng: -15.60,
  });
  const pedidoId = typeof ord.corpo === "string" ? ord.corpo : null;
  pedidoId ? ok("pedido de entrega criado") : ko("create_order falhou", JSON.stringify(ord.corpo).slice(0, 200));
  if (!pedidoId) return;

  for (const estado of ["confirmado", "em_preparacao", "pronto"]) {
    const r = await rpc(dono.token, "update_order_status", { p_order_id: pedidoId, p_new_status: estado });
    if (r.status >= 400) ko(`transicao para ${estado}`, JSON.stringify(r.corpo).slice(0, 160));
  }

  // --- 1. a entrega existe, apesar de nao haver coordenadas -------------
  console.log("\n1. Sem GPS, a entrega e criada na mesma");
  const est = (await tabela(dono.token, `orders?select=status&id=eq.${pedidoId}`)).corpo?.[0]?.status;
  est === "aguardando_motorista"
    ? ok("o pedido avancou para `aguardando_motorista`", "antes ficava preso em `pronto`")
    : ko("REGRESSAO: o pedido nao avancou", `ficou em ${est}`);

  const ent = (await tabela(dono.token,
    `deliveries?select=id,distance_km,restaurant_lat,customer_lat&order_id=eq.${pedidoId}`)).corpo?.[0];
  ent?.id
    ? ok("linha em `deliveries` criada sem coordenadas")
    : ko("REGRESSAO: pedido de entrega sem entrega associada");

  // §40: a distancia e' NULL, nunca um numero. A formula de haversine com NULLs
  // NAO da NULL -- `GREATEST(-1.0, NULL)` ignora o NULL, da -1.0, e acos(-1.0)
  // e' pi, o que sairia como ~20.015 km com ar credivel.
  ent && ent.distance_km === null
    ? ok("`distance_km` e NULL, nao um valor inventado")
    : ko("DISTANCIA INVENTADA", `distance_km = ${ent?.distance_km}`);

  // --- 2. a rede de seguranca nao ladra ao caso legitimo ----------------
  console.log("\n2. alert_stuck_orders nao pode dar falso positivo");
  console.log("   (o job corre ao minuto; espera-se para ele ter chance de errar)");
  await dormir(150_000);
  const presos = (await presosDe(dono)).filter((n) => n.reference_id === pedidoId);
  presos.length === 0
    ? ok("nenhum aviso de `pedido_preso` para um pedido saudavel", `${hora()}`)
    : ko("FALSO POSITIVO", JSON.stringify(presos.map((n) => n.title)));

  console.log(`\n  SQL de limpeza (privilegio de admin):`);
  console.log(`    DELETE FROM auth.users WHERE email LIKE 'rlstest-%@deliveryapp.test';\n`);
}

main()
  .catch((err) => ko("ERRO", err.message))
  .finally(() => {
    console.log(`\n${passou} passou, ${falhou} falhou\n`);
    process.exit(falhou > 0 ? 1 : 0);
  });

/*
 * INJECCAO DE FALHA — como se verifica que a rede de seguranca ainda dispara.
 *
 * Depois da decisao de 2026-09-16 ja nao ha maneira de produzir, so por HTTP, um
 * pedido de entrega sem linha em `deliveries`: e' precisamente isso que a
 * correccao garante. Para confirmar que o `alert_stuck_orders` continua a
 * funcionar, fabrica-se a avaria com privilegio de admin e mede-se a RESPOSTA
 * pelo caminho normal, com o JWT do restaurante:
 *
 *   1. correr este teste ate ao fim e guardar o `order_id`
 *   2. como admin:
 *        DELETE FROM public.dispatch_attempts WHERE order_id = '<id>';
 *        DELETE FROM public.deliveries        WHERE order_id = '<id>';
 *        UPDATE public.orders SET status = 'pronto' WHERE id = '<id>';
 *   3. esperar > 2 min (a folga) e mais um minuto (o pg_cron)
 *   4. pelo HTTP do restaurante, confirmar que chega uma notificacao
 *      `pedido_preso` com `reference_id` = <id>, e SO UMA.
 *
 * O privilegio serve para CRIAR a avaria, nunca para a medir -- a medicao e'
 * sempre pelo caminho que um utilizador real percorre. Verificado assim em
 * 2026-09-16.
 */
