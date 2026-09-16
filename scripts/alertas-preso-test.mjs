#!/usr/bin/env node
/**
 * FASE 2.2 — o pedido preso SEM entrega, por HTTP real.
 *
 * O CENARIO, que so' apareceu a testar: um restaurante sem lat/lng no perfil
 * recebe um pedido de entrega. Ao marcar "pronto", o `update_order_status` NAO
 * cria linha em `deliveries` (precisa das coordenadas dos dois lados para a
 * distancia) mas poe o pedido em `aguardando_motorista` na mesma. O cliente ve
 * "a procurar motorista"; nenhuma frota ve nada; e `expire_stale_dispatch`
 * nunca o apanha porque faz JOIN a `deliveries`.
 *
 * Aqui mede-se que o `alert_stuck_orders` (pg_cron, ao minuto) rompe esse
 * silencio -- e que so' avisa UMA vez, que e' a parte que um teste ingenuo
 * deixaria passar: um job ao minuto que nao seja idempotente manda 60 avisos
 * por hora do mesmo pedido.
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
const presos = async (c) =>
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

  // FICA EM `pronto`, e nao em `aguardando_motorista`: e' o ramo sem
  // coordenadas do update_order_status, que nao converte o estado. Para um
  // pedido de ENTREGA, `pronto` nao e' estado de repouso -- e' o preso.
  const est = (await tabela(dono.token, `orders?select=status&id=eq.${pedidoId}`)).corpo?.[0]?.status;
  est === "pronto"
    ? ok("o pedido de entrega ficou parado em `pronto`")
    : ko("estado inesperado", est);

  const ent = await tabela(dono.token, `deliveries?select=id&order_id=eq.${pedidoId}`);
  (ent.corpo ?? []).length === 0
    ? ok("e NAO existe entrega nenhuma — o pedido esta preso")
    : ko("houve entrega; este teste nao reproduz o cenario", JSON.stringify(ent.corpo));

  const rondas = await tabela(dono.token, `dispatch_attempts?select=id&order_id=eq.${pedidoId}`);
  (rondas.corpo ?? []).length === 0
    ? ok("nenhuma ronda de dispatch — invisivel ao expire_stale_dispatch")
    : ko("houve ronda", JSON.stringify(rondas.corpo));

  console.log(`\n1. A espera do alert_stuck_orders (pg_cron ao minuto) — ${hora()}`);
  let achou = null;
  for (let i = 0; i < 9 && !achou; i++) {
    await dormir(30_000);
    achou = (await presos(dono)).find((n) => n.reference_id === pedidoId) ?? null;
    if (!achou) console.log(`     ${hora()} ainda nada`);
  }
  achou
    ? ok("o restaurante foi avisado do pedido preso", `${hora()} — "${achou.title}"`)
    : ko("PEDIDO PRESO EM SILENCIO", "4,5 minutos sem aviso");

  if (achou) {
    /Verifique a morada do seu perfil/.test(achou.message ?? achou.body ?? "")
      ? ok("o aviso diz o que fazer a seguir (§83)")
      : ko("aviso sem accao", JSON.stringify(achou.message ?? achou.body ?? "").slice(0, 160));

    // A parte que um teste ingenuo nao apanha: o job corre ao MINUTO.
    console.log("\n2. Idempotencia — o job volta a correr daqui a 1 min");
    const antes = (await presos(dono)).filter((n) => n.reference_id === pedidoId).length;
    await dormir(80_000);
    const depois = (await presos(dono)).filter((n) => n.reference_id === pedidoId).length;
    depois === antes && antes === 1
      ? ok("continua UM unico aviso depois de o job voltar a correr", "nao spamma de minuto a minuto")
      : ko("AVISO REPETIDO pelo agendador", `${antes} -> ${depois}`);
  }

  console.log(`\n  SQL de limpeza (privilegio de admin):`);
  console.log(`    DELETE FROM auth.users WHERE email LIKE 'rlstest-%@deliveryapp.test';\n`);
}

main()
  .catch((err) => ko("ERRO", err.message))
  .finally(() => {
    console.log(`\n${passou} passou, ${falhou} falhou\n`);
    process.exit(falhou > 0 ? 1 : 0);
  });
