#!/usr/bin/env node
/**
 * FASE 2.3 — fecho de caixa, por HTTP real com JWT de utilizador normal.
 *
 * O QUE ESTA FASE ARRISCA, e porque o teste e desconfiado:
 *
 *  1. A DIVIDA TEM DE DESCER DOS DOIS LADOS. As leituras da Fase 6 somam por
 *     `entry_type` exacto, portanto um tipo novo escrito no ledger nao entra em
 *     conta nenhuma enquanto os leitores nao o conhecerem. Uma liquidacao podia
 *     ficar perfeitamente registada e a divida continuar igual no painel. Por
 *     isso nunca se verifica so que a RPC devolveu 200: mede-se o numero que a
 *     frota ve E o numero que o restaurante ve, a cada passo.
 *
 *  2. NAO SE PODE LIQUIDAR MAIS DO QUE SE DEVE. Tres declaracoes de 10.000
 *     sobre uma divida de 10.000, todas confirmadas, dariam -20.000. O tecto
 *     tem de contar tambem o que esta declarado por confirmar, nao so o que ja
 *     foi confirmado.
 *
 *  3. CONFIRMAR DUAS VEZES NAO PODE LIQUIDAR DUAS VEZES (§73) -- duplo toque,
 *     retry, ligacao lenta.
 *
 *  4. ISOLAMENTO (§46), pelos DOIS caminhos: a RPC e a tabela directa. Uma RPC
 *     SECURITY DEFINER salta o RLS da tabela, portanto verde numa nao diz nada
 *     sobre a outra.
 *
 *   node scripts/fecho-caixa-test.mjs
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
const BAIRRO = `ZonaCaixa${Date.now() % 100000}`;
const COMIDA = 10000, TAXA = 1500;
let passou = 0, falhou = 0;
const ok = (n, d = "") => { passou++; console.log(`  \x1b[32m✓\x1b[0m ${n}${d ? ` — ${d}` : ""}`); };
const ko = (n, d = "") => { falhou++; console.log(`  \x1b[31m✗\x1b[0m ${n}${d ? ` — ${d}` : ""}`); };

async function signup(etiqueta) {
  const r = await fetch(`${URL_BASE}/auth/v1/signup`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: `${MARCA}-${etiqueta}@deliveryapp.test`, password: "TesteCaixa#2026", data: { name: etiqueta } }),
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
const erro = (r) => JSON.stringify(r.corpo?.message ?? r.corpo ?? "").slice(0, 150);

async function main() {
  console.log(`\nFASE 2.3 — fecho de caixa (${MARCA})\n`);
  console.log("Preparacao");

  const dono = await signup("dono");
  const cliente = await signup("cliente");
  const frota = await signup("frota");
  const motorista = await signup("motorista");
  const outroDono = await signup("outrodono");
  const outraFrota = await signup("outrafrota");

  await rpc(dono.token, "register_as_business");
  await rpc(outroDono.token, "register_as_business");
  const biz = (await tabela(dono.token, `profiles?select=id&user_id=eq.${dono.user_id}`)).corpo?.[0]?.id;
  const bizOutro = (await tabela(outroDono.token, `profiles?select=id&user_id=eq.${outroDono.user_id}`)).corpo?.[0]?.id;
  if (!biz || !bizOutro) throw new Error("sem perfis de restaurante");

  await tabela(dono.token, `profiles?user_id=eq.${dono.user_id}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ lat: 11.8636, lng: -15.5977 }),
  });

  const NOME = `Bianda ${MARCA}`;
  const item = (await tabela(dono.token, "menu_items", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ business_id: biz, name: NOME, price: COMIDA }),
  })).corpo[0].id;

  await rpc(frota.token, "create_fleet", { p_name: `Frota ${MARCA}`, p_phone: `9${String(Date.now()).slice(-7)}` });
  await rpc(outraFrota.token, "create_fleet", { p_name: `Outra ${MARCA}`, p_phone: `9${String(Date.now() + 3).slice(-7)}` });
  await rpc(frota.token, "upsert_zone_price", { p_bairro: BAIRRO, p_preco: TAXA });

  const telMot = `9${String(Date.now() + 9).slice(-7)}`;
  await tabela(motorista.token, `profiles?user_id=eq.${motorista.user_id}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ phone: telMot }),
  });
  await rpc(frota.token, "add_driver_to_fleet", { p_phone: telMot, p_name: "Motorista Caixa" });
  await rpc(motorista.token, "toggle_driver_availability");
  ok("contas, frota, motorista e menu criados");

  // Pedido A DINHEIRO, levado ate ao fim pelo caminho real do motorista.
  const ord = await rpc(cliente.token, "create_order", {
    p_business_id: biz, p_customer_id: cliente.user_id,
    p_customer_name: "Cliente Caixa", p_customer_phone: "955000888",
    p_items: [{ menu_item_id: item, name: NOME, price: COMIDA, qty: 1 }],
    p_total: COMIDA, p_consumption_option: "entrega", p_bairro: BAIRRO,
    p_address: "Perto da escola", p_payment_method: "entrega",
    p_customer_lat: 11.8701, p_customer_lng: -15.6012,
  });
  const pedidoId = typeof ord.corpo === "string" ? ord.corpo : null;
  pedidoId ? ok("pedido a dinheiro criado") : ko("create_order falhou", erro(ord));
  if (!pedidoId) return;

  for (const e of ["confirmado", "em_preparacao", "pronto"]) {
    await rpc(dono.token, "update_order_status", { p_order_id: pedidoId, p_new_status: e });
  }
  const entregaId = (await tabela(dono.token, `deliveries?select=id&order_id=eq.${pedidoId}`)).corpo?.[0]?.id;
  await rpc(motorista.token, "accept_delivery", { p_delivery_id: entregaId });
  await rpc(motorista.token, "pickup_delivery", { p_delivery_id: entregaId });
  // FASE 9.3: concluir exige prova (codigo OU foto). O caminho realista e o
  // do codigo: quem o tem da-o ao motorista, que o valida -- e a validacao
  // regista a prova e conclui. `complete_delivery` sozinho ja nao conclui.
  const codigo = (await tabela(cliente.token, `orders?select=delivery_code&id=eq.${pedidoId}`)).corpo?.[0]?.delivery_code;
  const fim = await rpc(motorista.token, "validate_delivery_code", { p_delivery_id: entregaId, p_code: codigo });
  fim.corpo === true ? ok("entrega concluida pelo motorista", "com o codigo do cliente") : ko("validacao do codigo falhou", erro(fim));

  // Os dois lados da mesma divida.
  const daFrota = async () => (await rpc(frota.token, "get_fleet_financials")).corpo ?? {};
  const doResto = async () => (await rpc(dono.token, "get_business_commission", { p_business_id: biz })).corpo?.[0] ?? {};

  let f = await daFrota(), b = await doResto();
  Number(f.divida_restaurantes) === COMIDA
    ? ok(`frota deve ${COMIDA} ao restaurante (§28)`)
    : ko("divida da frota errada", `${f.divida_restaurantes}`);
  Number(b.food_receivable) === COMIDA
    ? ok(`restaurante tem ${COMIDA} a receber`)
    : ko("a receber do restaurante errado", `${b.food_receivable}`);

  // --- 1. declarar de mais e recusado ------------------------------------
  console.log("\n1. Tectos da declaracao");
  const demais = await rpc(frota.token, "declare_cash_settlement", { p_business_id: biz, p_amount: COMIDA + 1 });
  demais.status >= 400 && /acima do que esta em divida/.test(erro(demais))
    ? ok("declarar mais do que se deve e recusado")
    : ko("ACEITOU declarar acima da divida", erro(demais));

  const negativo = await rpc(frota.token, "declare_cash_settlement", { p_business_id: biz, p_amount: -500 });
  negativo.status >= 400 ? ok("valor negativo recusado") : ko("aceitou valor negativo");

  // --- 2. declarar e confirmar uma parte ---------------------------------
  console.log("\n2. Liquidacao parcial");
  const d1 = await rpc(frota.token, "declare_cash_settlement", { p_business_id: biz, p_amount: 4000, p_note: "Entregue a tarde" });
  const acerto1 = typeof d1.corpo === "string" ? d1.corpo : null;
  acerto1 ? ok("frota declarou 4.000") : ko("declaracao falhou", erro(d1));

  // Enquanto nao confirmam, NADA muda nas contas.
  f = await daFrota(); b = await doResto();
  Number(f.divida_restaurantes) === COMIDA && Number(b.food_receivable) === COMIDA
    ? ok("declarar sozinho nao mexe nas contas", "so a confirmacao liquida")
    : ko("a declaracao mexeu nas contas", `frota ${f.divida_restaurantes}, resto ${b.food_receivable}`);

  // O tecto passa a contar o que ja esta em cima da mesa.
  const acumula = await rpc(frota.token, "declare_cash_settlement", { p_business_id: biz, p_amount: 7000 });
  acumula.status >= 400
    ? ok("segunda declaracao que ultrapassaria o total e recusada", "4.000 + 7.000 > 10.000")
    : ko("PODE DECLARAR DUAS VEZES A MESMA DIVIDA", "risco de liquidar a mais");

  const conf1 = await rpc(dono.token, "confirm_cash_settlement", { p_settlement_id: acerto1 });
  conf1.status < 300 ? ok("restaurante confirmou") : ko("confirmacao falhou", erro(conf1));

  f = await daFrota(); b = await doResto();
  Number(f.divida_restaurantes) === COMIDA - 4000
    ? ok(`divida da frota desceu para ${COMIDA - 4000}`)
    : ko("A DIVIDA DA FROTA NAO DESCEU", `${f.divida_restaurantes}`);
  Number(b.food_receivable) === COMIDA - 4000
    ? ok(`a receber do restaurante desceu para ${COMIDA - 4000}`)
    : ko("O A RECEBER NAO DESCEU", `${b.food_receivable} — o leitor da Fase 6 nao conta o tipo novo`);

  // --- 3. confirmar duas vezes -------------------------------------------
  console.log("\n3. Idempotencia (§73)");
  const repetir = await rpc(dono.token, "confirm_cash_settlement", { p_settlement_id: acerto1 });
  repetir.status >= 400 ? ok("confirmar de novo e recusado", erro(repetir).slice(0, 60)) : ko("CONFIRMOU DUAS VEZES");

  f = await daFrota();
  Number(f.divida_restaurantes) === COMIDA - 4000
    ? ok("a divida nao desceu duas vezes", `${f.divida_restaurantes}`)
    : ko("LIQUIDOU A DOBRAR", `${f.divida_restaurantes}`);

  const paralelo = await Promise.all([1, 2, 3, 4, 5].map(() =>
    rpc(dono.token, "confirm_cash_settlement", { p_settlement_id: acerto1 })));
  paralelo.every((r) => r.status >= 400)
    ? ok("cinco confirmacoes simultaneas: todas recusadas")
    : ko("uma confirmacao simultanea passou", JSON.stringify(paralelo.map((r) => r.status)));

  // --- 4. contestar -------------------------------------------------------
  console.log("\n4. Contestacao");
  const d2 = await rpc(frota.token, "declare_cash_settlement", { p_business_id: biz, p_amount: 6000 });
  const acerto2 = typeof d2.corpo === "string" ? d2.corpo : null;

  const semMotivo = await rpc(dono.token, "contest_cash_settlement", { p_settlement_id: acerto2, p_reason: "  " });
  semMotivo.status >= 400 ? ok("contestar sem motivo e recusado (§84)") : ko("contestou sem explicar");

  const cont = await rpc(dono.token, "contest_cash_settlement", { p_settlement_id: acerto2, p_reason: "So recebi 3.000" });
  cont.status < 300 ? ok("restaurante contestou com motivo") : ko("contestacao falhou", erro(cont));

  f = await daFrota(); b = await doResto();
  Number(f.divida_restaurantes) === COMIDA - 4000 && Number(b.food_receivable) === COMIDA - 4000
    ? ok("contestar deixa a divida de pe", `continua ${COMIDA - 4000}`)
    : ko("a contestacao mexeu nas contas", `${f.divida_restaurantes} / ${b.food_receivable}`);

  const estado2 = (await tabela(dono.token, `cash_settlements?select=status,contest_reason&id=eq.${acerto2}`)).corpo?.[0];
  estado2?.status === "contestado" && /So recebi 3.000/.test(estado2?.contest_reason ?? "")
    ? ok("a contestacao ficou registada com o motivo")
    : ko("contestacao sem rasto", JSON.stringify(estado2));

  // --- 5. saldar o resto --------------------------------------------------
  console.log("\n5. Saldar o resto");
  const d3 = await rpc(frota.token, "declare_cash_settlement", { p_business_id: biz, p_amount: 6000 });
  const acerto3 = typeof d3.corpo === "string" ? d3.corpo : null;
  acerto3 ? ok("frota voltou a declarar 6.000", "o contestado nao bloqueia") : ko("nova declaracao falhou", erro(d3));

  await rpc(dono.token, "confirm_cash_settlement", { p_settlement_id: acerto3 });
  f = await daFrota(); b = await doResto();
  Number(f.divida_restaurantes) === 0 ? ok("frota nao deve nada") : ko("divida da frota", `${f.divida_restaurantes}`);
  Number(b.food_receivable) === 0 ? ok("restaurante nao tem nada a receber") : ko("a receber", `${b.food_receivable}`);

  const esgotado = await rpc(frota.token, "declare_cash_settlement", { p_business_id: biz, p_amount: 100 });
  esgotado.status >= 400 ? ok("com a divida saldada nao se declara mais") : ko("declarou sobre divida zero");

  // §56: o historico nao desaparece.
  const linhas = (await tabela(frota.token, `ledger_entries?select=entry_type,amount&settlement_id=not.is.null&order=created_at`)).corpo ?? [];
  linhas.length === 4
    ? ok("4 linhas de ledger, 2 por acerto confirmado (partida dobrada)")
    : ko("linhas de ledger inesperadas", JSON.stringify(linhas));

  // --- 6. isolamento, pelos dois caminhos --------------------------------
  console.log("\n6. Isolamento (§46)");
  const d4 = await rpc(frota.token, "declare_cash_settlement", { p_business_id: biz, p_amount: 1 });
  // (divida zero, portanto isto falha; usa-se o acerto contestado para os testes de acesso)

  const alheioConfirma = await rpc(outroDono.token, "confirm_cash_settlement", { p_settlement_id: acerto2 });
  alheioConfirma.status >= 400
    ? ok("outro restaurante nao confirma um acerto que nao e dele")
    : ko("ISOLAMENTO QUEBRADO: confirmou acerto alheio");

  const alheioCancela = await rpc(outraFrota.token, "cancel_cash_settlement", { p_settlement_id: acerto2 });
  alheioCancela.status >= 400
    ? ok("outra frota nao retira a declaracao alheia")
    : ko("ISOLAMENTO QUEBRADO: cancelou acerto alheio");

  const alheioDeclara = await rpc(outraFrota.token, "declare_cash_settlement", { p_business_id: biz, p_amount: 500 });
  alheioDeclara.status >= 400
    ? ok("outra frota nao declara sobre divida que nao tem")
    : ko("ISOLAMENTO QUEBRADO: declarou por conta de outra frota");

  // TABELA DIRECTA — caminho diferente do das RPCs, falha de maneira diferente.
  const leAlheio = await tabela(outroDono.token, `cash_settlements?select=id,amount&fleet_id=eq.${f.fleet_id}`);
  (leAlheio.corpo ?? []).length === 0
    ? ok("outro restaurante le ZERO acertos na tabela directa", `HTTP ${leAlheio.status}`)
    : ko("ISOLAMENTO QUEBRADO na tabela directa", JSON.stringify(leAlheio.corpo).slice(0, 160));

  const leProprioFrota = await tabela(frota.token, `cash_settlements?select=id,status`);
  (leProprioFrota.corpo ?? []).length >= 3
    ? ok("a frota le os SEUS acertos na tabela directa", `${leProprioFrota.corpo.length} linhas`)
    : ko("a frota nao ve os proprios acertos", JSON.stringify(leProprioFrota.corpo).slice(0, 160));

  const leProprioResto = await tabela(dono.token, `cash_settlements?select=id,status`);
  (leProprioResto.corpo ?? []).length >= 3
    ? ok("o restaurante le os SEUS acertos na tabela directa", `${leProprioResto.corpo.length} linhas`)
    : ko("o restaurante nao ve os proprios acertos", JSON.stringify(leProprioResto.corpo).slice(0, 160));

  const escrita = await tabela(frota.token, "cash_settlements", {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ fleet_id: f.fleet_id, business_id: biz, amount: 99999, status: "confirmado" }),
  });
  escrita.status >= 400
    ? ok("ninguem escreve na tabela a mao", `HTTP ${escrita.status}`)
    : ko("ESCRITA DIRECTA PERMITIDA — o fluxo de confirmacao fica decorativo");

  const anonLe = await fetch(`${URL_BASE}/rest/v1/cash_settlements?select=id`, { headers: { apikey: ANON } });
  anonLe.status === 401 || anonLe.status === 403
    ? ok("anonimo recusado", `HTTP ${anonLe.status}`)
    : ko("anonimo NAO recusado", `HTTP ${anonLe.status}`);

  // --- 7. o ecra do fecho -------------------------------------------------
  console.log("\n7. Ecra do fecho de caixa");
  const fecho = (await rpc(frota.token, "get_fleet_cash_closing")).corpo ?? {};
  Array.isArray(fecho.motoristas) && fecho.motoristas.length === 1
    && Number(fecho.motoristas[0].dinheiro_recolhido) === COMIDA
    ? ok("o fecho diz quem andou com o dinheiro (§39)", `${fecho.motoristas[0].nome}: ${COMIDA}`)
    : ko("motoristas no fecho errados", JSON.stringify(fecho.motoristas));

  const doRest = (await rpc(dono.token, "get_business_cash_settlements", { p_business_id: biz })).corpo ?? {};
  Number(doRest.a_receber_total) === 0 && (doRest.acertos ?? []).length >= 3
    ? ok("o restaurante ve o historico dos acertos", `${doRest.acertos.length} acertos`)
    : ko("historico do restaurante errado", JSON.stringify(doRest).slice(0, 200));

  const alheioFecho = await rpc(outroDono.token, "get_business_cash_settlements", { p_business_id: biz });
  alheioFecho.status >= 400
    ? ok("nao se le o fecho de outro restaurante pela RPC")
    : ko("ISOLAMENTO QUEBRADO em get_business_cash_settlements");

  console.log(`\n  SQL de limpeza (privilegio de admin):`);
  console.log(`    DELETE FROM auth.users WHERE email LIKE 'rlstest-%@deliveryapp.test';\n`);
}

main()
  .catch((err) => ko("ERRO", err.message))
  .finally(() => {
    console.log(`\n${passou} passou, ${falhou} falhou\n`);
    process.exit(falhou > 0 ? 1 : 0);
  });
