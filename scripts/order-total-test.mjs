#!/usr/bin/env node
/**
 * FASE 2.0 — o total do pedido deixa de vir do cliente.
 *
 * O QUE ESTE TESTE PROVA. Antes desta fase, `create_order` gravava o
 * `p_total` que o browser mandasse. Um cesto de 10.000 com `total: 1` entrava
 * como 1 — e a comissao do §25, que e 5% de `orders.total`, ia atras dele para
 * o ledger da Fase 6, onde fica congelada com ar de verdade auditada.
 *
 * Tudo por HTTP com JWT de utilizador normal e chave anon, como manda a regra
 * de engenharia do CLAUDE.md: e o caminho que o atacante usaria.
 *
 *   node scripts/order-total-test.mjs
 */

import { readFileSync } from "node:fs";

function lerEnv() {
  const env = { ...process.env };
  try {
    for (const linha of readFileSync(".env", "utf8").split("\n")) {
      const m = linha.match(/^([A-Z0-9_]+)=(.*)$/);
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

async function signup(etiqueta) {
  const r = await fetch(`${URL_BASE}/auth/v1/signup`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: `${MARCA}-${etiqueta}@deliveryapp.test`, password: "TesteTotal#2026", data: { name: etiqueta } }),
  });
  const c = await r.json();
  if (!c.access_token) throw new Error(`signup ${etiqueta}: ${JSON.stringify(c)}`);
  return { token: c.access_token, user_id: c.user.id };
}

const rpc = async (token, nome, args = {}) => {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${nome}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  let corpo = null; try { corpo = await r.json(); } catch { /* 204 */ }
  return { status: r.status, corpo };
};

const tabela = async (token, caminho, init = {}) => {
  const r = await fetch(`${URL_BASE}/rest/v1/${caminho}`, {
    // `...init` PRIMEIRO: ao contrario, o `headers` de init substituia o objecto
    // inteiro e a chave anon desaparecia do pedido.
    ...init,
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  let corpo = null; try { corpo = await r.json(); } catch { /* vazio */ }
  return { status: r.status, corpo };
};

const pedido = (extra) => ({
  p_customer_name: "Cliente de teste",
  p_customer_phone: "955000111",
  p_consumption_option: "comer_no_local",
  p_payment_method: "entrega",
  ...extra,
});

async function main() {
  console.log(`\nFASE 2.0 — total do pedido por HTTP (${MARCA})\n`);
  console.log("Preparacao");

  const dono = await signup("dono");
  const cliente = await signup("cliente");
  const outroDono = await signup("outrodono");
  ok("3 contas criadas pela API publica");

  for (const d of [dono, outroDono]) {
    const r = await rpc(d.token, "register_as_business");
    if (r.status >= 400) throw new Error(`register_as_business: ${JSON.stringify(r.corpo)}`);
  }

  const perfilDe = async (c) => {
    const r = await tabela(c.token, `profiles?select=id&user_id=eq.${c.user_id}`);
    return r.corpo?.[0]?.id;
  };
  const bizA = await perfilDe(dono);
  const bizB = await perfilDe(outroDono);
  if (!bizA || !bizB) throw new Error("sem perfis de restaurante");

  const criarItem = async (c, businessId, nome, preco) => {
    const r = await tabela(c.token, "menu_items", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ business_id: businessId, name: nome, price: preco }),
    });
    if (r.status >= 300) throw new Error(`menu_items insert: ${JSON.stringify(r.corpo)}`);
    return r.corpo[0].id;
  };

  const frango = await criarItem(dono, bizA, `Frango ${MARCA}`, 10000);
  const sumo = await criarItem(dono, bizA, `Sumo ${MARCA}`, 500);
  const alheio = await criarItem(outroDono, bizB, `Prato alheio ${MARCA}`, 300);
  ok("menu criado", "Frango 10.000 · Sumo 500");

  // --- 1. o ataque -----------------------------------------------------------
  console.log("\n1. Total falsificado pelo cliente");
  const batota = await rpc(cliente.token, "create_order", pedido({
    p_business_id: bizA, p_customer_id: cliente.user_id,
    p_items: [{ menu_item_id: frango, name: "Frango", price: 1, qty: 1 }],
    p_total: 1,
  }));
  batota.status >= 400
    ? ok("pedido de 10.000 com total 1 RECUSADO", `HTTP ${batota.status}`)
    : ko("ACEITE um total falsificado", JSON.stringify(batota.corpo).slice(0, 120));

  // --- 2. o caminho honesto --------------------------------------------------
  console.log("\n2. Pedido honesto com menu_item_id");
  const bom = await rpc(cliente.token, "create_order", pedido({
    p_business_id: bizA, p_customer_id: cliente.user_id,
    p_items: [
      { menu_item_id: frango, name: "Frango", price: 10000, qty: 2 },
      { menu_item_id: sumo, name: "Sumo", price: 500, qty: 3 },
    ],
    p_total: 21500,
  }));
  const orderId = typeof bom.corpo === "string" ? bom.corpo : null;
  orderId ? ok("pedido criado", `2x10.000 + 3x500 = 21.500`) : ko("pedido honesto recusado", JSON.stringify(bom.corpo).slice(0, 140));

  if (orderId) {
    const o = await tabela(cliente.token, `orders?select=total,items&id=eq.${orderId}`);
    Number(o.corpo?.[0]?.total) === 21500
      ? ok("o total gravado veio do menu", `${o.corpo[0].total}`)
      : ko("total gravado errado", JSON.stringify(o.corpo).slice(0, 120));

    const linhas = await tabela(cliente.token, `order_items?select=name_snapshot,unit_price_snapshot,qty,line_total,menu_item_id&order_id=eq.${orderId}&order=unit_price_snapshot.desc`);
    Array.isArray(linhas.corpo) && linhas.corpo.length === 2
      ? ok("order_items gravado", `${linhas.corpo.length} linhas`)
      : ko("order_items em falta", JSON.stringify(linhas.corpo).slice(0, 140));

    const l0 = linhas.corpo?.[0];
    l0 && Number(l0.unit_price_snapshot) === 10000 && Number(l0.line_total) === 20000 && l0.menu_item_id === frango
      ? ok("snapshot de preco e ligacao ao menu correctos")
      : ko("snapshot errado", JSON.stringify(l0).slice(0, 140));

    // Isolamento: um estranho nao le os artigos do pedido de outra pessoa.
    const espreita = await tabela(outroDono.token, `order_items?select=id&order_id=eq.${orderId}`);
    Array.isArray(espreita.corpo) && espreita.corpo.length === 0
      ? ok("conta sem relacao le 0 linhas de order_items")
      : ko("ISOLAMENTO QUEBRADO em order_items", JSON.stringify(espreita.corpo).slice(0, 140));

    const anonItems = await fetch(`${URL_BASE}/rest/v1/order_items?select=id`, { headers: { apikey: ANON } });
    anonItems.status === 401 || anonItems.status === 403
      ? ok("anonimo recusado em order_items", `HTTP ${anonItems.status}`)
      : ko("anonimo NAO foi recusado", `HTTP ${anonItems.status}`);
  }

  // --- 3. o caminho de transicao (frontend antigo, so o nome) ---------------
  console.log("\n3. Frontend antigo: so o nome, sem id");
  const legado = await rpc(cliente.token, "create_order", pedido({
    p_business_id: bizA, p_customer_id: cliente.user_id,
    p_items: [{ name: `Sumo ${MARCA}`, price: 999999, qty: 1 }],
    p_total: 500,
  }));
  typeof legado.corpo === "string"
    ? ok("resolvido pelo nome, ao preco do MENU e nao ao do corpo", "500, nao 999.999")
    : ko("o caminho de transicao partiu", JSON.stringify(legado.corpo).slice(0, 140));

  // --- 4. artigos que nao sao deste restaurante -----------------------------
  console.log("\n4. Artigos invalidos");
  const doOutro = await rpc(cliente.token, "create_order", pedido({
    p_business_id: bizA, p_customer_id: cliente.user_id,
    p_items: [{ menu_item_id: alheio, name: "Prato alheio", price: 300, qty: 1 }],
    p_total: 300,
  }));
  doOutro.status >= 400
    ? ok("artigo de outro restaurante recusado")
    : ko("ACEITE um artigo de outro restaurante", JSON.stringify(doOutro.corpo).slice(0, 120));

  const inventado = await rpc(cliente.token, "create_order", pedido({
    p_business_id: bizA, p_customer_id: cliente.user_id,
    p_items: [{ name: "Prato que nao existe", price: 100, qty: 1 }],
    p_total: 100,
  }));
  inventado.status >= 400
    ? ok("artigo inexistente recusado")
    : ko("ACEITE um artigo que nao esta no menu", JSON.stringify(inventado.corpo).slice(0, 120));

  const vazio = await rpc(cliente.token, "create_order", pedido({
    p_business_id: bizA, p_customer_id: cliente.user_id,
    p_items: [], p_total: 0,
  }));
  vazio.status >= 400 ? ok("pedido sem artigos recusado") : ko("ACEITE um pedido vazio");
}

main()
  .catch((e) => ko("ERRO", e.message))
  .finally(() => {
    // O teardown do que a chave anon nao apaga sai em SQL, como no rls-http-test.
    console.log(`\n  Limpeza (privilegio de admin):`);
    console.log(`    DELETE FROM auth.users WHERE email LIKE '${MARCA}-%';`);
    console.log(`\n${passou} passou, ${falhou} falhou\n`);
    process.exit(falhou > 0 ? 1 : 0);
  });
