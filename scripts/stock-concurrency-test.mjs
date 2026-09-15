#!/usr/bin/env node
/**
 * FASE 2.1 — stock e numero de pedido sob concorrencia REAL.
 *
 * O QUE ISTO MEDE. Duas correccoes da mesma familia, ambas ler-depois-escrever:
 *
 *   stock         ler 1 disponivel -> decidir -> escrever 0
 *   order_number  SELECT MAX(order_number) + 1
 *
 * Nos dois casos, dois pedidos simultaneos leem o mesmo valor antes de qualquer
 * um escrever, e os dois ganham. Nao ha erro nenhum a assinalar isso -- por
 * isso um teste sequencial passa sempre e nao prova nada. O unico teste que
 * vale e' disparar os pedidos ao MESMO tempo, por HTTP, contra a base a serio.
 *
 *   node scripts/stock-concurrency-test.mjs
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
const N = 20;
let passou = 0, falhou = 0;
const ok = (n, d = "") => { passou++; console.log(`  \x1b[32m✓\x1b[0m ${n}${d ? ` — ${d}` : ""}`); };
const ko = (n, d = "") => { falhou++; console.log(`  \x1b[31m✗\x1b[0m ${n}${d ? ` — ${d}` : ""}`); };

async function signup(etiqueta) {
  const r = await fetch(`${URL_BASE}/auth/v1/signup`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: `${MARCA}-${etiqueta}@deliveryapp.test`, password: "TesteStock#2026", data: { name: etiqueta } }),
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
    ...init,
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  let corpo = null; try { corpo = await r.json(); } catch { /* vazio */ }
  return { status: r.status, corpo };
};

async function main() {
  console.log(`\nFASE 2.1 — stock sob concorrencia (${MARCA})\n`);
  console.log("Preparacao");

  const dono = await signup("dono");
  const cliente = await signup("cliente");
  const estranho = await signup("estranho");
  await rpc(dono.token, "register_as_business");
  await rpc(estranho.token, "register_as_business");

  const perfil = await tabela(dono.token, `profiles?select=id&user_id=eq.${dono.user_id}`);
  const biz = perfil.corpo?.[0]?.id;
  if (!biz) throw new Error("sem perfil de restaurante");

  const criarItem = async (nome, preco) => {
    const r = await tabela(dono.token, "menu_items", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ business_id: biz, name: nome, price: preco }),
    });
    if (r.status >= 300) throw new Error(`menu_items: ${JSON.stringify(r.corpo)}`);
    return r.corpo[0].id;
  };

  const ultimo = await criarItem(`Ultimo frango ${MARCA}`, 1000);
  const muitos = await criarItem(`Sumo ${MARCA}`, 200);
  ok("contas e menu criados");

  const stock = await rpc(dono.token, "set_menu_item_stock", { p_menu_item_id: ultimo, p_stock_qty: 1 });
  Number(stock.corpo) === 1 ? ok("stock posto a 1") : ko("set_menu_item_stock falhou", JSON.stringify(stock.corpo).slice(0, 120));
  await rpc(dono.token, "set_menu_item_stock", { p_menu_item_id: muitos, p_stock_qty: 500 });

  // Cada chamada regista quando comecou e quando acabou, para se poder medir
  // a sobreposicao REAL em vez de a inferir de duracoes totais.
  const janelas = [];
  const encomendar = async (itemId, nome, preco, qty = 1) => {
    const inicio = Date.now();
    const r = await encomendarSemMedir(itemId, nome, preco, qty);
    janelas.push({ inicio, fim: Date.now() });
    return r;
  };

  const encomendarSemMedir = (itemId, nome, preco, qty = 1) => rpc(cliente.token, "create_order", {
    p_business_id: biz, p_customer_id: cliente.user_id,
    p_customer_name: "Cliente", p_customer_phone: "955000222",
    p_items: [{ menu_item_id: itemId, name: nome, price: preco, qty }],
    p_total: preco * qty,
    p_consumption_option: "comer_no_local", p_payment_method: "entrega",
  });

  // --- 1. vinte pedidos a ultima unidade, ao mesmo tempo --------------------
  console.log(`\n1. ${N} pedidos em paralelo a ultima unidade`);

  // PROVA DE QUE SAO MESMO SIMULTANEOS. Se o Promise.all estivesse a
  // serializar -- limite de sockets, por exemplo -- o teste passava sem provar
  // atomicidade nenhuma: 20 pedidos em fila nunca disputam nada. Mede-se a
  // sobreposicao: se o lote inteiro demorar perto do que demora UM pedido, e
  // nao 20x isso, e porque correram ao mesmo tempo.
  const t0 = Date.now();
  const corrida = await Promise.all(
    Array.from({ length: N }, () => encomendar(ultimo, "Ultimo frango", 1000)),
  );
  const duracaoLote = Date.now() - t0;
  const ganharam = corrida.filter((r) => typeof r.corpo === "string").length;
  const recusados = corrida.filter((r) => r.status >= 400).length;

  ganharam === 1
    ? ok(`exactamente 1 ganhou`, `${ganharam} sucesso, ${recusados} recusados`)
    : ko(`VENDIDO A MAIS: ${ganharam} pedidos ganharam a mesma unidade`);
  recusados === N - 1 ? ok(`os outros ${N - 1} foram recusados`) : ko("contagem de recusas errada", `${recusados}`);

  const semStock = corrida.find((r) => r.status >= 400);
  /[Ss]em stock/.test(JSON.stringify(semStock?.corpo ?? ""))
    ? ok("a recusa explica-se", "\"Sem stock suficiente\"")
    : ko("recusa com mensagem inesperada", JSON.stringify(semStock?.corpo).slice(0, 120));

  // SOBREPOSICAO MEDIDA, nao inferida. Comparar a duracao do lote com a de um
  // pedido sozinho parecia bom e nao era: a duracao de um pedido varia entre
  // ~130ms e ~500ms conforme a ligacao esteja quente, portanto o limiar media
  // ruido de rede em vez de concorrencia. Aqui percorre-se a linha temporal e
  // conta-se quantos pedidos estiveram EM VOO ao mesmo tempo -- e' um facto
  // sobre o que aconteceu, nao uma estimativa.
  const eventos = janelas
    .flatMap((j) => [{ t: j.inicio, d: +1 }, { t: j.fim, d: -1 }])
    .sort((a, b) => a.t - b.t || a.d - b.d);
  let emVoo = 0, pico = 0;
  for (const e of eventos) { emVoo += e.d; if (emVoo > pico) pico = emVoo; }

  pico >= 2
    ? ok("os pedidos sobrepuseram-se mesmo", `${pico} em voo ao mesmo tempo, lote ${duracaoLote}ms`)
    : ko("SERIALIZADOS: nenhum pedido se sobrepos, o teste nao prova nada", `pico ${pico}`);

  const depois = await tabela(dono.token, `menu_items?select=stock_qty,is_available,is_orderable&id=eq.${ultimo}`);
  const m = depois.corpo?.[0];
  Number(m?.stock_qty) === 0 ? ok("stock ficou em 0") : ko("stock final errado", JSON.stringify(m));
  m?.is_orderable === false ? ok("o artigo deixou de ser pedivel, sozinho") : ko("continua pedivel a 0", JSON.stringify(m));
  m?.is_available === true ? ok("o interruptor do dono NAO foi tocado") : ko("o esgotamento escreveu por cima do dono", JSON.stringify(m));

  // --- 2. numeros de pedido sob concorrencia -------------------------------
  console.log(`\n2. ${N} pedidos em paralelo — numeros repetidos?`);
  const corrida2 = await Promise.all(
    Array.from({ length: N }, () => encomendar(muitos, "Sumo", 200)),
  );
  const ids = corrida2.filter((r) => typeof r.corpo === "string").map((r) => r.corpo);
  ids.length === N ? ok(`os ${N} pedidos passaram`) : ko("nem todos passaram", `${ids.length}/${N}`);

  const nums = await tabela(dono.token, `orders?select=order_number&business_id=eq.${biz}`);
  const lista = (nums.corpo ?? []).map((o) => o.order_number);
  const unicos = new Set(lista);
  lista.length === unicos.size
    ? ok("nenhum numero repetido", `${unicos.size} numeros distintos`)
    : ko("NUMEROS REPETIDOS", `${lista.length} pedidos, ${unicos.size} numeros`);

  // --- 3. reposicao volta a ligar o artigo ---------------------------------
  console.log("\n3. Reposicao");
  await rpc(dono.token, "set_menu_item_stock", { p_menu_item_id: ultimo, p_stock_qty: 5, p_motivo: "Chegou mais" });
  const reposto = await tabela(dono.token, `menu_items?select=stock_qty,is_orderable&id=eq.${ultimo}`);
  reposto.corpo?.[0]?.is_orderable === true && Number(reposto.corpo[0].stock_qty) === 5
    ? ok("repor voltou a ligar o artigo sozinho", "5 unidades")
    : ko("reposicao nao reactivou", JSON.stringify(reposto.corpo));

  const ajustes = await tabela(dono.token, `stock_adjustments?select=delta,motivo,qty_antes,qty_depois&menu_item_id=eq.${ultimo}&order=created_at.desc`);
  Array.isArray(ajustes.corpo) && ajustes.corpo.length >= 3
    ? ok("cada mexida ficou registada", `${ajustes.corpo.length} ajustes`)
    : ko("faltam ajustes no registo", JSON.stringify(ajustes.corpo).slice(0, 140));

  // --- 4. cancelar devolve, e so uma vez -----------------------------------
  console.log("\n4. Cancelamento devolve o stock");
  const pedidoVivo = corrida.find((r) => typeof r.corpo === "string")?.corpo;
  const antes = Number((await tabela(dono.token, `menu_items?select=stock_qty&id=eq.${ultimo}`)).corpo?.[0]?.stock_qty);
  const canc = await rpc(dono.token, "update_order_status", { p_order_id: pedidoVivo, p_new_status: "cancelado" });
  if (canc.status >= 400) { ko("nao consegui cancelar", JSON.stringify(canc.corpo).slice(0, 120)); }
  const dep = Number((await tabela(dono.token, `menu_items?select=stock_qty&id=eq.${ultimo}`)).corpo?.[0]?.stock_qty);
  dep === antes + 1 ? ok("a unidade voltou ao stock", `${antes} -> ${dep}`) : ko("stock nao foi devolvido", `${antes} -> ${dep}`);

  // --- 5. o dono nao escreve stock a mao -----------------------------------
  console.log("\n5. Caminhos de escrita fechados");
  const aMao = await tabela(dono.token, `menu_items?id=eq.${ultimo}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ stock_qty: 9999 }),
  });
  aMao.status >= 400
    ? ok("dono nao consegue escrever stock_qty directamente", `HTTP ${aMao.status}`)
    : ko("STOCK ESCRITO A MAO — o registo de ajustes fica decorativo", `HTTP ${aMao.status}`);

  const doOutro = await rpc(estranho.token, "set_menu_item_stock", { p_menu_item_id: ultimo, p_stock_qty: 100 });
  doOutro.status >= 400
    ? ok("estranho recusado em set_menu_item_stock")
    : ko("ISOLAMENTO QUEBRADO: estranho mexeu no stock alheio");

  const ajustesEstranho = await tabela(estranho.token, `stock_adjustments?select=id&menu_item_id=eq.${ultimo}`);
  Array.isArray(ajustesEstranho.corpo) && ajustesEstranho.corpo.length === 0
    ? ok("estranho le 0 ajustes de stock alheios")
    : ko("ISOLAMENTO QUEBRADO em stock_adjustments", JSON.stringify(ajustesEstranho.corpo).slice(0, 120));

  const anonStock = await fetch(`${URL_BASE}/rest/v1/stock_adjustments?select=id`, { headers: { apikey: ANON } });
  anonStock.status === 401 || anonStock.status === 403
    ? ok("anonimo recusado em stock_adjustments", `HTTP ${anonStock.status}`)
    : ko("anonimo NAO recusado", `HTTP ${anonStock.status}`);
}

main()
  .catch((e) => ko("ERRO", e.message))
  .finally(() => {
    console.log(`\n  Limpeza (privilegio de admin):`);
    console.log(`    DELETE FROM auth.users WHERE email LIKE '${MARCA}-%';`);
    console.log(`\n${passou} passou, ${falhou} falhou\n`);
    process.exit(falhou > 0 ? 1 : 0);
  });
