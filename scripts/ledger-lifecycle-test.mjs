#!/usr/bin/env node
/**
 * Percurso completo do ledger por HTTP real: concluir -> cancelar -> reconcluir.
 *
 * PORQUE EXISTE. A migracao 20260915090100 acrescentou o `ciclo` a
 * `ledger_entries`, e e' a peca com risco real da Fase 6.1: se o ciclo for mal
 * calculado, uma reconclusao duplica a comissao em vez de a reescrever, e o
 * parceiro passa a dever o dobro sem nada no ecra a explicar porque'. Isso nao
 * se ve num `npm run build` nem num teste de funcao pura -- so' fazendo o
 * percurso inteiro contra a base.
 *
 * O QUE ESTE TESTE NAO E'. Nao e' um teste de RLS. As assercoes correm todas
 * por HTTP com JWT de utilizador normal e chave anon, como manda a regra do
 * CLAUDE.md, mas o que se mede aqui e' ARITMETICA do ledger, nao autorizacao --
 * essa esta' no `rls-http-test.mjs`.
 *
 * DUAS FASES, e porque. Conceder o papel `admin` a uma conta exige privilegio
 * que a chave anon nao tem, e o admin e' indispensavel: `concluido` e' um
 * estado terminal (§36) e so' a valvula de correccao do admin consegue cancelar
 * a partir dele. Conceder o papel e' MONTAGEM DE FIXTURE, nao uma assercao --
 * por isso pode ser feito com privilegio sem enfraquecer o teste. O que nao
 * podia era uma assercao correr sob `service_role`.
 *
 *   node scripts/ledger-lifecycle-test.mjs --fase=1   # cria as contas
 *   (conceder `admin` ao user_id que a fase 1 imprime)
 *   node scripts/ledger-lifecycle-test.mjs --fase=2   # o percurso e a limpeza
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

function lerEnv() {
  const env = { ...process.env };
  try {
    for (const linha of readFileSync(".env", "utf8").split("\n")) {
      const m = linha.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* .env e' opcional */ }
  return env;
}

const env = lerEnv();
const URL_BASE = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!URL_BASE || !ANON) {
  console.error("Faltam VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY");
  process.exit(1);
}

const ESTADO = "/tmp/ledger-lifecycle-estado.json";
const fase = process.argv.find((a) => a.startsWith("--fase="))?.split("=")[1] ?? "2";

let passou = 0, falhou = 0;
const ok = (n, d = "") => { passou++; console.log(`  \x1b[32m✓\x1b[0m ${n}${d ? ` — ${d}` : ""}`); };
const ko = (n, d = "") => { falhou++; console.log(`  \x1b[31m✗\x1b[0m ${n}${d ? ` — ${d}` : ""}`); };

async function signup(marca, etiqueta) {
  const email = `${marca}-${etiqueta}@deliveryapp.test`;
  const r = await fetch(`${URL_BASE}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "TesteLedger#2026", data: { name: etiqueta } }),
  });
  const c = await r.json();
  if (!c.access_token) throw new Error(`signup ${etiqueta}: ${JSON.stringify(c)}`);
  return { email, token: c.access_token, user_id: c.user.id };
}

async function rpc(token, nome, args = {}) {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${nome}`, {
    method: "POST",
    headers: {
      apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  let corpo = null;
  try { corpo = await r.json(); } catch { /* 204 */ }
  return { status: r.status, corpo };
}

// ATENCAO: aceita `init`. Antes nao aceitava e ignorava-o em silencio, o que
// transformava qualquer POST num GET -- um "INSERT" devolvia a primeira linha
// legivel da tabela e o teste seguia com dados de outra pessoa. Custou uma
// investigacao; fica explicito.
async function tabela(token, caminho, init = {}) {
  const r = await fetch(`${URL_BASE}/rest/v1/${caminho}`, {
    ...init,
    headers: {
      apikey: ANON, Authorization: `Bearer ${token}`,
      "Content-Type": "application/json", ...(init.headers ?? {}),
    },
  });
  let corpo = null;
  try { corpo = await r.json(); } catch { /* vazio */ }
  return { status: r.status, corpo };
}

// ---------------------------------------------------------------------------
// FASE 1 -- contas e fixtures. Termina a pedir o papel de admin.
// ---------------------------------------------------------------------------
async function fase1() {
  const marca = `rlstest-${Date.now()}`;
  console.log(`\nFase 1 — montagem (${marca})\n`);

  const restaurante = await signup(marca, "restaurante");
  const frota = await signup(marca, "frota");
  const cliente = await signup(marca, "cliente");
  const admin = await signup(marca, "admin");
  ok("4 contas criadas pela API publica");

  const reg = await rpc(restaurante.token, "register_as_business");
  if (reg.status >= 400) throw new Error(`register_as_business: ${JSON.stringify(reg.corpo)}`);
  ok("conta de restaurante registada");

  // O `business_id` de um pedido e' o `profiles.id` do dono, nao o user_id.
  const perfil = await tabela(restaurante.token, `profiles?select=id&user_id=eq.${restaurante.user_id}`);
  const businessId = perfil.corpo?.[0]?.id;
  if (!businessId) throw new Error(`sem perfil de restaurante: ${JSON.stringify(perfil.corpo)}`);

  // Checkout, ponto 4 (2026-09-17): `create_order` so aceita `online` se o
  // restaurante recebe por Orange Money. Sem isto o pedido online da fase 2 e'
  // recusado antes de o ledger ser exercitado.
  const om = await tabela(restaurante.token, `profiles?id=eq.${businessId}`, { method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ merchant_code: "#144#32*000000#", orange_money_method: "codigo" }) });
  if (om.status >= 400) throw new Error(`orange_money_method: ${JSON.stringify(om.corpo)}`);

  // BAIRRO PROPRIO DO TESTE, e nao o nome real "Sabi". `get_delivery_price`
  // escolhe a frota mais BARATA de todas as que cobrem o bairro (empate
  // desempatado pela mais antiga), portanto um nome real fazia este teste
  // competir com frotas verdadeiras -- ou com frotas de teste de corridas
  // anteriores, que foi o que aconteceu: o pedido foi parar a frota de uma
  // execucao antiga e as contas desta davam zero.
  const bairro = `ZonaLedger${marca.slice(-6)}`;
  const f = await rpc(frota.token, "create_fleet", {
    p_name: `Frota ${marca}`, p_phone: "900000001", p_bairro: bairro,
  });
  if (f.status !== 200) throw new Error(`create_fleet: ${JSON.stringify(f.corpo)}`);
  ok("frota criada", String(f.corpo).slice(0, 8));

  // §13: o preco e' por bairro, cadastrado previamente pela frota.
  const preco = await rpc(frota.token, "upsert_zone_price", { p_bairro: bairro, p_preco: 1000 });
  if (preco.status >= 400) throw new Error(`upsert_zone_price: ${JSON.stringify(preco.corpo)}`);
  ok("preco de zona definido", `${bairro} = 1.000 FCFA`);

  // O ARTIGO TEM DE EXISTIR NO MENU. Este teste mandava `{name:"Prato",
  // price:10000}` a solta, e isso funcionou ate a Fase 2.0 (20260915140000)
  // passar o `create_order` a resolver os artigos contra o menu e a somar o
  // total no servidor (§46, §83). Desde ai o teste morria na montagem com
  // "Artigo nao existe no menu" -- e como e o UNICO que prova que reconcluir
  // um pedido nao duplica a comissao, essa garantia esteve sem rede.
  const item = await tabela(restaurante.token, "menu_items", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ business_id: businessId, name: `Prato ${marca}`, price: 10000 }),
  });
  const menuItemId = item.corpo?.[0]?.id;
  if (!menuItemId) throw new Error(`menu_items: ${JSON.stringify(item.corpo)}`);
  ok("artigo criado no menu", "10.000 FCFA");

  writeFileSync(ESTADO, JSON.stringify({
    marca, restaurante, frota, cliente, admin, businessId, fleetId: f.corpo,
    menuItemId, menuItemName: `Prato ${marca}`, bairro,
  }, null, 2));

  console.log(`\n  Estado guardado em ${ESTADO}`);
  console.log(`\n  FALTA conceder o papel de admin (montagem de fixture, com privilegio):`);
  console.log(`    INSERT INTO public.user_roles (user_id, role)`);
  console.log(`    VALUES ('${admin.user_id}', 'admin') ON CONFLICT DO NOTHING;`);
  console.log(`\n  Depois:  node scripts/ledger-lifecycle-test.mjs --fase=2\n`);
}

// ---------------------------------------------------------------------------
// FASE 2 -- o percurso, e a limpeza no fim aconteca o que acontecer
// ---------------------------------------------------------------------------
async function fase2() {
  if (!existsSync(ESTADO)) throw new Error(`sem estado da fase 1 (${ESTADO})`);
  const e = JSON.parse(readFileSync(ESTADO, "utf8"));
  const { restaurante, frota, cliente, admin, businessId } = e;
  console.log(`\nFase 2 — percurso do ledger (${e.marca})\n`);

  // Confirmar que o admin e' mesmo admin, senao o teste mede outra coisa.
  const prova = await rpc(admin.token, "get_all_commissions");
  if (prova.status !== 200) {
    throw new Error(`a conta admin nao tem o papel: ${JSON.stringify(prova.corpo)}`);
  }
  ok("conta de admin confirmada por HTTP");

  // --- pedido ONLINE de 10.000, entrega em Sabi (1.000) ---------------------
  // Ponto 4: `online` exige um comprovativo que EXISTE na pasta do proprio cliente.
  const caminhoProva = `${cliente.user_id}/orders/payment/${Date.now()}-ledger.png`;
  const up = await fetch(`${URL_BASE}/storage/v1/object/portfolio/${caminhoProva}`, { method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${cliente.token}`, "Content-Type": "image/png" },
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") });
  if (up.status >= 300) throw new Error(`upload do comprovativo: HTTP ${up.status}`);
  const novo = await rpc(cliente.token, "create_order", {
    p_business_id: businessId,
    p_customer_id: cliente.user_id,
    p_customer_name: "Cliente de teste",
    p_customer_phone: "955000000",
    p_items: [{ menu_item_id: e.menuItemId, name: e.menuItemName, price: 10000, qty: 1 }],
    p_total: 10000,
    p_consumption_option: "entrega",
    p_address: "Rua de teste",
    p_bairro: e.bairro,
    p_payment_method: "online",
    p_payment_proof_url: `${URL_BASE}/storage/v1/object/public/portfolio/${caminhoProva}`,
  });
  if (novo.status !== 200) throw new Error(`create_order: ${JSON.stringify(novo.corpo)}`);
  const orderId = typeof novo.corpo === "string" ? novo.corpo : novo.corpo?.id ?? novo.corpo;
  ok("pedido online criado", `10.000 comida + 1.000 entrega`);

  const estado = async (token, para) => {
    const r = await rpc(token, "update_order_status", { p_order_id: orderId, p_new_status: para });
    if (r.status >= 400) throw new Error(`${para}: ${JSON.stringify(r.corpo)}`);
  };

  // O restaurante leva o pedido ate `pronto`. A partir da correccao "entrega
  // sem GPS" (2026-09-16) marcar `pronto` num pedido de ENTREGA cria sempre a
  // linha de `deliveries` e converte o estado para `aguardando_motorista` --
  // antes, sem coordenadas, nao criava nada e o pedido ficava em `pronto`, de
  // onde `concluido` era transicao valida. Este teste dependia desse
  // comportamento antigo.
  for (const s of ["confirmado", "em_preparacao", "pronto"]) {
    await estado(restaurante.token, s);
  }
  // A conclusao passa a ser pela valvula do admin, que e' como o resto deste
  // teste ja conduz os estados (o cancelamento e a reconclusao mais abaixo).
  // O objecto de estudo aqui e' o LEDGER, nao o dispatch -- percorrer
  // aceitar/recolher/entregar com um motorista a serio so acrescentava partes
  // moveis a um teste que existe para medir outra coisa.
  await estado(admin.token, "concluido");
  ok("pedido levado ate concluido", "restaurante ate `pronto`, admin conclui");

  const contaRestaurante = async () => {
    const r = await rpc(restaurante.token, "get_business_commission", { p_business_id: businessId });
    if (r.status !== 200) throw new Error(`get_business_commission: ${JSON.stringify(r.corpo)}`);
    return Array.isArray(r.corpo) ? r.corpo[0] : r.corpo;
  };
  const contaFrota = async () => {
    const r = await rpc(frota.token, "get_fleet_financials");
    if (r.status !== 200) throw new Error(`get_fleet_financials: ${JSON.stringify(r.corpo)}`);
    return r.corpo;
  };

  // --- 1. depois de concluir -------------------------------------------------
  console.log("\n1. Pedido concluido");
  let b = await contaRestaurante();
  let fr = await contaFrota();

  Number(b.total_sales) === 10000 ? ok("restaurante: vendas 10.000") : ko("restaurante: vendas", `${b.total_sales}`);
  Number(b.commission_due) === 500 ? ok("restaurante: comissao 500 (§25)") : ko("restaurante: comissao", `${b.commission_due}`);
  // §28 ao contrario: pagamento online, ninguem entregou dinheiro ao motorista.
  Number(b.food_receivable) === 0 ? ok("restaurante: nada a receber da frota") : ko("restaurante: food_receivable", `${b.food_receivable}`);
  Number(b.delivery_payable) === 1000 ? ok("restaurante: deve 1.000 de entrega a frota") : ko("restaurante: delivery_payable", `${b.delivery_payable}`);

  Number(fr.comissao_gerada) === 50 ? ok("frota: comissao 50 (§26)") : ko("frota: comissao", `${fr.comissao_gerada}`);
  Number(fr.a_receber_restaurantes) === 1000 ? ok("frota: 1.000 a receber do restaurante") : ko("frota: a_receber_restaurantes", `${fr.a_receber_restaurantes}`);
  Number(fr.divida_restaurantes) === 0 ? ok("frota: nada a entregar (nao foi a dinheiro)") : ko("frota: divida_restaurantes", `${fr.divida_restaurantes}`);
  Number(fr.entregas_faturadas) === 1 ? ok("frota: 1 entrega faturada") : ko("frota: entregas_faturadas", `${fr.entregas_faturadas}`);

  // --- 2. cancelar (valvula do admin, §36) ----------------------------------
  console.log("\n2. Admin cancela um pedido ja concluido");
  await estado(admin.token, "cancelado");
  b = await contaRestaurante();
  fr = await contaFrota();

  // O defeito da Fase 6.0 estava exactamente aqui: num pedido `online` a venda
  // continuava a contar depois do cancelamento.
  Number(b.total_sales) === 0 ? ok("restaurante: vendas voltam a 0 (o defeito da 6.0)") : ko("restaurante: vendas apos cancelar", `${b.total_sales}`);
  Number(b.commission_due) === 0 ? ok("restaurante: comissao volta a 0") : ko("restaurante: comissao apos cancelar", `${b.commission_due}`);
  Number(b.delivery_payable) === 0 ? ok("restaurante: ja nao deve a entrega") : ko("restaurante: delivery_payable apos cancelar", `${b.delivery_payable}`);
  Number(fr.entregas_faturadas) === 0 ? ok("frota: entrega deixa de contar como faturada") : ko("frota: entregas_faturadas apos cancelar", `${fr.entregas_faturadas}`);
  Number(fr.a_receber_restaurantes) === 0 ? ok("frota: ja nao tem a receber") : ko("frota: a_receber apos cancelar", `${fr.a_receber_restaurantes}`);

  // O historico NAO desaparece (§56).
  const movs = fr.movimentos?.length ?? 0;
  movs >= 4 ? ok("o historico fica no extracto", `${movs} movimentos`) : ko("o extracto perdeu linhas", `${movs}`);

  // --- 3. reconcluir: o ciclo 2 ---------------------------------------------
  console.log("\n3. Admin reconclui o mesmo pedido (ciclo 2)");
  await estado(admin.token, "concluido");
  b = await contaRestaurante();
  fr = await contaFrota();

  // O RISCO DA MIGRACAO B: se o ciclo falhar, isto da' 20.000 / 1.000.
  Number(b.total_sales) === 10000 ? ok("restaurante: vendas 10.000, NAO 20.000") : ko("DUPLICOU a venda", `${b.total_sales}`);
  Number(b.commission_due) === 500 ? ok("restaurante: comissao 500, NAO 1.000") : ko("DUPLICOU a comissao", `${b.commission_due}`);
  Number(b.delivery_payable) === 1000 ? ok("restaurante: deve 1.000, NAO 2.000") : ko("DUPLICOU a taxa de entrega", `${b.delivery_payable}`);
  Number(fr.comissao_gerada) === 50 ? ok("frota: comissao 50, NAO 100") : ko("DUPLICOU a comissao da frota", `${fr.comissao_gerada}`);
  Number(fr.a_receber_restaurantes) === 1000 ? ok("frota: 1.000 a receber, NAO 2.000") : ko("DUPLICOU o valor a receber", `${fr.a_receber_restaurantes}`);
  Number(fr.entregas_faturadas) === 1 ? ok("frota: 1 entrega faturada, NAO 2") : ko("DUPLICOU a entrega faturada", `${fr.entregas_faturadas}`);

  console.log(`\n  SQL de limpeza (privilegio de admin):`);
  console.log(`    DELETE FROM auth.users WHERE email LIKE 'rlstest-%@deliveryapp.test';\n`);
}

(async () => {
  try {
    if (fase === "1") await fase1(); else await fase2();
  } catch (err) {
    ko("ERRO", err.message);
  } finally {
    if (fase !== "1") console.log(`\n${passou} passou, ${falhou} falhou\n`);
    process.exit(falhou > 0 ? 1 : 0);
  }
})();
