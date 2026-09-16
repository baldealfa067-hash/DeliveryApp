#!/usr/bin/env node
/**
 * FASE 2.2 — alertas, por HTTP real com JWT de utilizador normal.
 *
 * PORQUE HTTP E NAO MCP/service_role: `service_role` ignora o RLS por completo,
 * portanto um teste que passe por la nao prova que o restaurante ve os SEUS
 * alertas e nao os do vizinho -- prova so que o SQL compila. Ver a REGRA DE
 * ENGENHARIA no CLAUDE.md, e a avaria de producao que a originou.
 *
 * O que se mede aqui, e porque:
 *
 *  1. ALERTAS DE STOCK POR TRANSICAO. O erro facil era avisar sempre que
 *     `stock_qty <= limiar`, o que dispara em cada venda abaixo do limiar e
 *     ensina o dono a ignorar o sino. Por isso o teste nao se contenta com "o
 *     alerta chegou": conta-os, e exige que a segunda venda abaixo do limiar
 *     NAO produza um segundo aviso.
 *
 *  2. DUPLICACAO. Antes desta fase cada notificacao saia a dobrar, em
 *     producao. Um teste de "chegou?" passava na mesma -- chegava, duas vezes.
 *     Por isso as assertivas sao de IGUALDADE a 1, nunca de ">= 1".
 *
 *  3. ISOLAMENTO PELOS DOIS CAMINHOS. Uma RPC `SECURITY DEFINER` salta o RLS da
 *     tabela, portanto `get_my_notifications` verde nao diz nada sobre a
 *     leitura directa de `/rest/v1/notifications`. Mede-se os dois: ja houve um
 *     caso em producao em que discordaram em silencio.
 *
 *   node scripts/alertas-test.mjs
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

async function signup(etiqueta) {
  const r = await fetch(`${URL_BASE}/auth/v1/signup`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `${MARCA}-${etiqueta}@deliveryapp.test`,
      password: "TesteAlertas#2026", data: { name: etiqueta },
    }),
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

// Le SEMPRE pelos dois caminhos e avisa se discordarem -- e' exactamente esse
// desacordo silencioso que a regra de engenharia manda procurar.
async function avisos(conta, filtro = () => true) {
  const viaRpc = await rpc(conta.token, "get_my_notifications", { p_limit: 200 });
  const viaTabela = await tabela(conta.token, "notifications?select=id,title,body,type&order=created_at.desc&limit=200");
  const a = (viaRpc.corpo ?? []).filter(filtro);
  const b = (viaTabela.corpo ?? []).filter(filtro);
  if (a.length !== b.length) {
    ko("RPC e tabela discordam", `rpc=${a.length} tabela=${b.length}`);
  }
  return a;
}

const conta = (lista, re) => lista.filter((n) => re.test(n.title ?? "")).length;

async function main() {
  console.log(`\nFASE 2.2 — alertas (${MARCA})\n`);
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

  const NOME_A = `Cafriela ${MARCA}`;
  const NOME_B = `Caldo ${MARCA}`;
  const itemA = await criarItem(NOME_A, 1000);
  const itemB = await criarItem(NOME_B, 2000);
  ok("contas e menu criados");

  const encomendar = (itemId, nome, preco, qty) => rpc(cliente.token, "create_order", {
    p_business_id: biz, p_customer_id: cliente.user_id,
    p_customer_name: "Cliente Teste", p_customer_phone: "955000333",
    p_items: [{ menu_item_id: itemId, name: nome, price: preco, qty }],
    p_total: preco * qty,
    p_consumption_option: "comer_no_local", p_payment_method: "entrega",
  });

  // --- 1. limiar de stock baixo --------------------------------------------
  console.log("\n1. Stock baixo — o alerta e por ATRAVESSAMENTO, nao por estado");
  await rpc(dono.token, "set_menu_item_stock", { p_menu_item_id: itemA, p_stock_qty: 6 });

  const semAviso = await avisos(dono, (n) => n.type === "stock");
  semAviso.length === 0 ? ok("por stock 6, ainda nenhum alerta") : ko("alerta a mais", `${semAviso.length}`);

  await encomendar(itemA, NOME_A, 1000, 1); // 6 -> 5, acima do limiar
  const a5 = await avisos(dono, (n) => n.type === "stock");
  a5.length === 0 ? ok("6 -> 5 (acima de 3): sem alerta") : ko("alertou acima do limiar", JSON.stringify(a5.map(n=>n.title)));

  await encomendar(itemA, NOME_A, 1000, 2); // 5 -> 3, atravessa
  const a3 = await avisos(dono, (n) => n.type === "stock");
  conta(a3, /^Stock baixo/) === 1
    ? ok("5 -> 3 (atravessa o limiar): 1 alerta de stock baixo")
    : ko("alerta de stock baixo em falta ou repetido", `${conta(a3, /^Stock baixo/)}`);
  /Restam 3 unidade/.test(a3.find((n) => /^Stock baixo/.test(n.title))?.body ?? "")
    ? ok("o alerta diz quantas restam", "\"Restam 3 unidade(s)\"")
    : ko("corpo do alerta inesperado", JSON.stringify(a3[0]?.body ?? "").slice(0, 120));

  // O ponto todo do desenho: JA esta abaixo do limiar, nao se repete.
  await encomendar(itemA, NOME_A, 1000, 1); // 3 -> 2, ja abaixo
  const a2 = await avisos(dono, (n) => n.type === "stock");
  conta(a2, /^Stock baixo/) === 1
    ? ok("3 -> 2 (ja abaixo): NAO repete o alerta", "continua 1")
    : ko("ALERTA REPETIDO a cada venda", `${conta(a2, /^Stock baixo/)} avisos de stock baixo`);

  // --- 2. esgotado ----------------------------------------------------------
  console.log("\n2. Esgotado");
  await encomendar(itemA, NOME_A, 1000, 2); // 2 -> 0
  const a0 = await avisos(dono, (n) => n.type === "stock");
  conta(a0, /^Esgotado/) === 1
    ? ok("chegar a 0: 1 alerta de esgotado")
    : ko("alerta de esgotado em falta ou repetido", `${conta(a0, /^Esgotado/)}`);

  const estadoA = await tabela(dono.token, `menu_items?select=stock_qty,is_orderable,is_available&id=eq.${itemA}`);
  estadoA.corpo?.[0]?.is_orderable === false && Number(estadoA.corpo[0].stock_qty) === 0
    ? ok("o artigo esgotado deixou de ser pedivel")
    : ko("estado do artigo inesperado", JSON.stringify(estadoA.corpo));

  // Queda directa de cima do limiar para zero: esgotado GANHA, nao saem os dois.
  console.log("\n   Queda de 6 para 0 de uma vez (item B)");
  await rpc(dono.token, "set_menu_item_stock", { p_menu_item_id: itemB, p_stock_qty: 6 });
  await encomendar(itemB, NOME_B, 2000, 6);
  const b = await avisos(dono, (n) => n.type === "stock" && n.title.includes(NOME_B));
  conta(b, /^Esgotado/) === 1 && conta(b, /^Stock baixo/) === 0
    ? ok("6 -> 0: so \"Esgotado\", sem \"stock baixo\" a acompanhar")
    : ko("dois alertas para a mesma queda", JSON.stringify(b.map((n) => n.title)));

  // --- 3. repor nao alerta, e volta a armar o gatilho ----------------------
  console.log("\n3. Reposicao");
  const antesRepor = (await avisos(dono, (n) => n.type === "stock")).length;
  await rpc(dono.token, "set_menu_item_stock", { p_menu_item_id: itemA, p_stock_qty: 10, p_motivo: "Chegou mais" });
  const depoisRepor = await avisos(dono, (n) => n.type === "stock");
  depoisRepor.length === antesRepor
    ? ok("repor stock nao gera alerta nenhum", `continua ${antesRepor}`)
    : ko("a reposicao alertou", `${antesRepor} -> ${depoisRepor.length}`);

  await encomendar(itemA, NOME_A, 1000, 8); // 10 -> 2, atravessa outra vez
  const rearmado = await avisos(dono, (n) => n.type === "stock" && n.title.includes(NOME_A));
  conta(rearmado, /^Stock baixo/) === 2
    ? ok("depois de repor, o limiar volta a avisar", "2o aviso de stock baixo")
    : ko("o gatilho nao rearmou", `${conta(rearmado, /^Stock baixo/)} avisos`);

  // --- 4. novos pedidos: UMA vez, nao duas --------------------------------
  console.log("\n4. Novo pedido — a duplicacao que existia em producao");
  const novoPedido = await encomendar(itemA, NOME_A, 1000, 1);
  const pedidoId = typeof novoPedido.corpo === "string" ? novoPedido.corpo : null;
  pedidoId ? ok("pedido criado") : ko("pedido falhou", JSON.stringify(novoPedido.corpo).slice(0, 140));

  const doDono = await avisos(dono, (n) => n.type === "order");
  const numero = (await tabela(dono.token, `orders?select=order_number&id=eq.${pedidoId}`)).corpo?.[0]?.order_number;
  const reNovo = new RegExp(`^Novo Pedido #${numero}$`);
  conta(doDono, reNovo) === 1
    ? ok(`dono avisado UMA vez do pedido #${numero}`)
    : ko(`dono avisado ${conta(doDono, reNovo)}x do mesmo pedido`, "era 2 antes da Fase 2.2");

  const doCliente = await avisos(cliente, (n) => n.type === "order");
  conta(doCliente, new RegExp(`^Pedido #${numero} Criado$`)) === 1
    ? ok("cliente avisado UMA vez da criacao")
    : ko(`cliente avisado ${conta(doCliente, new RegExp(`^Pedido #${numero} Criado$`))}x`);

  // --- 5. mudanca de estado: UMA notificacao por acontecimento -----------
  console.log("\n5. Mudanca de estado");

  // Antes da Fase 2.2 este percurso produzia TRES avisos por passo: dois
  // triggers a correr a mesma funcao, mais um INSERT directo dentro do
  // update_order_status. Por isso as assertivas sao de igualdade a 1.
  const passos = ["confirmado", "em_preparacao", "pronto"];
  for (const estado of passos) {
    const r = await rpc(dono.token, "update_order_status", { p_order_id: pedidoId, p_new_status: estado });
    if (r.status >= 400) { ko(`transicao para ${estado} recusada`, JSON.stringify(r.corpo).slice(0, 160)); continue; }
  }

  const apos = await avisos(cliente, (n) => n.type === "order" || n.type === "order_update");
  const rotulos = { confirmado: "Confirmado", em_preparacao: "Em preparacao", pronto: "Pronto" };
  for (const estado of passos) {
    const re = new RegExp(`^Pedido #${numero} - ${rotulos[estado]}$`);
    conta(apos, re) === 1
      ? ok(`"${rotulos[estado]}": exactamente 1 aviso`)
      : ko(`"${rotulos[estado]}": ${conta(apos, re)} avisos`, "eram 3 antes da Fase 2.2");
  }

  conta(apos, /^Atualizacao do pedido$/) === 0
    ? ok("o aviso generico do update_order_status desapareceu", "era a 3a fonte")
    : ko(`ainda saem ${conta(apos, /^Atualizacao do pedido$/)} avisos genericos`);

  const confirmado = apos.find((n) => new RegExp(`^Pedido #${numero} - Confirmado$`).test(n.title));
  /O restaurante confirmou o seu pedido/.test(confirmado?.body ?? "")
    ? ok("o texto bom do update_order_status foi herdado pelo trigger")
    : ko("texto perdido na consolidacao", JSON.stringify(confirmado?.body ?? "").slice(0, 120));

  const estadoFinal = (await tabela(dono.token, `orders?select=status&id=eq.${pedidoId}`)).corpo?.[0]?.status;
  estadoFinal === "pronto"
    ? ok("a matriz de transicoes continua a funcionar", "novo -> confirmado -> em_preparacao -> pronto")
    : ko("o pedido nao avancou", `ficou em ${estadoFinal}`);

  const salto = await rpc(dono.token, "update_order_status", { p_order_id: pedidoId, p_new_status: "novo" });
  salto.status >= 400
    ? ok("salto de estado invalido continua recusado (§36)", `HTTP ${salto.status}`)
    : ko("A DISCIPLINA DE ESTADOS PARTIU-SE", "pronto -> novo foi aceite");

  const cru = apos.filter((n) => /- (aguardando_motorista|motorista_encontrado|em_preparacao|pedido_recolhido)$/.test(n.title ?? ""));
  cru.length === 0
    ? ok("nenhum nome de constante cru no titulo (§52)")
    : ko("jargao tecnico no ecra do cliente", JSON.stringify(cru.map((n) => n.title)));

  // --- 6. isolamento, pelos DOIS caminhos ---------------------------------
  console.log("\n6. Isolamento — RPC e tabela directa");
  const doEstranho = await avisos(estranho);
  const intrusos = doEstranho.filter((n) => (n.title ?? "").includes(MARCA) || (n.body ?? "").includes(MARCA));
  intrusos.length === 0
    ? ok("outro restaurante ve ZERO alertas nossos", `tem ${doEstranho.length} proprios`)
    : ko("ISOLAMENTO QUEBRADO", JSON.stringify(intrusos.map((n) => n.title)).slice(0, 160));

  const stockAlheio = await tabela(estranho.token, `notifications?select=id,title&type=eq.stock`);
  ((stockAlheio.corpo ?? []).filter((n) => (n.title ?? "").includes(MARCA))).length === 0
    ? ok("leitura DIRECTA da tabela por estranho: zero alertas de stock nossos", `HTTP ${stockAlheio.status}`)
    : ko("ISOLAMENTO QUEBRADO na tabela directa", JSON.stringify(stockAlheio.corpo).slice(0, 160));

  const escrita = await tabela(estranho.token, "notifications", {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ user_id: dono.user_id, type: "stock", title: "falso", body: "falso" }),
  });
  escrita.status >= 400
    ? ok("estranho nao consegue forjar um alerta para o dono", `HTTP ${escrita.status}`)
    : ko("QUALQUER UM ESCREVE NOTIFICACOES", `HTTP ${escrita.status}`);

  const anonLe = await fetch(`${URL_BASE}/rest/v1/notifications?select=id`, { headers: { apikey: ANON } });
  // O RLS ja segurava isto antes (o anonimo lia lista vazia); a Fase 2.2 tirou
  // tambem o GRANT, portanto passa a ser recusa em vez de lista vazia.
  const corpoAnon = await anonLe.json().catch(() => null);
  anonLe.status === 401 || anonLe.status === 403
    ? ok("anonimo recusado em notifications", `HTTP ${anonLe.status}`)
    : (Array.isArray(corpoAnon) && corpoAnon.length === 0
        ? ko("anonimo nao e recusado, so le vazio", `HTTP ${anonLe.status} — o REVOKE nao pegou`)
        : ko("ANONIMO LE NOTIFICACOES", JSON.stringify(corpoAnon).slice(0, 160)));

  console.log(`\n  SQL de limpeza (privilegio de admin):`);
  console.log(`    DELETE FROM auth.users WHERE email LIKE 'rlstest-%@deliveryapp.test';\n`);
}

main()
  .catch((err) => ko("ERRO", err.message))
  .finally(() => {
    console.log(`\n${passou} passou, ${falhou} falhou\n`);
    process.exit(falhou > 0 ? 1 : 0);
  });
