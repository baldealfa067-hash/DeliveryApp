#!/usr/bin/env node
/**
 * FASE 2.4 — pedidos manuais, por HTTP real com JWT de utilizador normal.
 *
 * O QUE ISTO TEM DE PROVAR, e porque cada ponto e um sitio onde e facil errar:
 *
 *  1. A ISENCAO DE COMISSAO TEM DE SER CIRURGICA (decisao 5). O pedido manual
 *     nao gera comissao -- mas TEM de continuar a gerar a divida de comida da
 *     frota ao restaurante (§28), que nao e comissao nenhuma: e dinheiro de
 *     terceiros. Isentar a mais fazia desaparecer dinheiro do restaurante, que
 *     e exactamente o buraco que a Fase 2.3 fechou. Mede-se os dois ao mesmo
 *     tempo: comissao a zero E divida de comida presente.
 *
 *  2. O TOTAL NAO PODE VIR DO ECRA. Quem lanca e o dono, mas o valor entra no
 *     ledger e na divida da frota -- um preco enviado pelo browser era um preco
 *     em que ninguem mandou.
 *
 *  3. O STOCK DESCONTA NA CRIACAO (decisao 3), e um pedido manual disputa a
 *     ultima unidade com um pedido da app em pe de igualdade.
 *
 *  4. ISOLAMENTO: so o dono lanca no SEU restaurante, e ninguem marca um pedido
 *     normal como manual para fugir a comissao.
 *
 *   node scripts/pedido-manual-test.mjs
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
const BAIRRO = `ZonaManual${Date.now() % 100000}`;
const PRECO = 5000, TAXA = 1000;
let passou = 0, falhou = 0;
const ok = (n, d = "") => { passou++; console.log(`  \x1b[32m✓\x1b[0m ${n}${d ? ` — ${d}` : ""}`); };
const ko = (n, d = "") => { falhou++; console.log(`  \x1b[31m✗\x1b[0m ${n}${d ? ` — ${d}` : ""}`); };

async function signup(etiqueta) {
  const r = await fetch(`${URL_BASE}/auth/v1/signup`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: `${MARCA}-${etiqueta}@deliveryapp.test`, password: "TesteManual#2026", data: { name: etiqueta } }),
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
  console.log(`\nFASE 2.4 — pedidos manuais (${MARCA})\n`);
  console.log("Preparacao");

  const dono = await signup("dono");
  const cliente = await signup("cliente");
  const frota = await signup("frota");
  const motorista = await signup("motorista");
  const estranho = await signup("estranho");

  await rpc(dono.token, "register_as_business");
  await rpc(estranho.token, "register_as_business");
  const biz = (await tabela(dono.token, `profiles?select=id&user_id=eq.${dono.user_id}`)).corpo?.[0]?.id;
  if (!biz) throw new Error("sem perfil");

  const NOME = `Cachupa ${MARCA}`;
  const item = (await tabela(dono.token, "menu_items", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ business_id: biz, name: NOME, price: PRECO }),
  })).corpo[0].id;

  await rpc(frota.token, "create_fleet", { p_name: `Frota ${MARCA}`, p_phone: `9${String(Date.now()).slice(-7)}` });
  await rpc(frota.token, "upsert_zone_price", { p_bairro: BAIRRO, p_preco: TAXA });
  const telMot = `9${String(Date.now() + 5).slice(-7)}`;
  await tabela(motorista.token, `profiles?user_id=eq.${motorista.user_id}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ phone: telMot }),
  });
  await rpc(frota.token, "add_driver_to_fleet", { p_phone: telMot, p_name: "Motorista Manual" });
  await rpc(motorista.token, "toggle_driver_availability");
  ok("restaurante, frota e motorista criados");

  const comissao = async () =>
    (await rpc(dono.token, "get_business_commission", { p_business_id: biz })).corpo?.[0] ?? {};
  const financasFrota = async () => (await rpc(frota.token, "get_fleet_financials")).corpo ?? {};

  // --- 1. venda ao balcao, concluida de imediato -------------------------
  console.log("\n1. Venda ao balcao (sem entrega)");
  await rpc(dono.token, "set_menu_item_stock", { p_menu_item_id: item, p_stock_qty: 10 });

  const balcao = await rpc(dono.token, "create_manual_order", {
    p_business_id: biz,
    p_items: [{ menu_item_id: item, qty: 2 }],
    p_consumption_option: "comer_no_local",
    p_customer_name: "Dona Fatu",
    p_concluir: true,
  });
  const idBalcao = typeof balcao.corpo === "string" ? balcao.corpo : null;
  idBalcao ? ok("pedido de balcao lancado e concluido") : ko("create_manual_order falhou", erro(balcao));
  if (!idBalcao) return;

  const oBalcao = (await tabela(dono.token, `orders?select=source,status,total,customer_id,order_number&id=eq.${idBalcao}`)).corpo?.[0];
  oBalcao?.source === "manual" ? ok("marcado source=manual") : ko("source errado", JSON.stringify(oBalcao));
  oBalcao?.status === "concluido" ? ok("ficou concluido") : ko("estado errado", oBalcao?.status);
  Number(oBalcao?.total) === PRECO * 2
    ? ok(`total somado do menu: ${PRECO * 2}`)
    : ko("total errado", `${oBalcao?.total}`);
  oBalcao?.customer_id === null ? ok("sem conta de cliente por tras") : ko("customer_id preenchido");

  const stock = (await tabela(dono.token, `menu_items?select=stock_qty&id=eq.${item}`)).corpo?.[0]?.stock_qty;
  Number(stock) === 8 ? ok("stock descontou na criacao (decisao 3)", "10 → 8") : ko("stock errado", `${stock}`);

  const ajuste = (await tabela(dono.token, `stock_adjustments?select=motivo,delta&order_id=eq.${idBalcao}`)).corpo?.[0];
  ajuste?.motivo === "Venda (pedido manual)" && Number(ajuste.delta) === -2
    ? ok("o desconto ficou registado e distingue-se de uma venda da app")
    : ko("ajuste de stock errado", JSON.stringify(ajuste));

  // A ISENCAO (decisao 5).
  let c = await comissao();
  Number(c.commission_due) === 0
    ? ok("venda ao balcao: NENHUMA comissao de restaurante (§25)", `divida a plataforma ${c.commission_due}`)
    : ko("PEDIDO MANUAL GEROU COMISSAO DE RESTAURANTE", `${c.commission_due}`);

  // Sem entrega nao ha frota nem taxa, logo nao pode haver comissao de frota.
  const fBalcao = await financasFrota();
  Number(fBalcao.comissao_gerada) === 0
    ? ok("venda ao balcao: nenhuma comissao de frota", "nao houve entrega")
    : ko("gerou comissao de frota sem entrega", `${fBalcao.comissao_gerada}`);

  // --- 2. o total nao vem do ecra ----------------------------------------
  console.log("\n2. O preco e do menu, nao de quem lanca");
  const forjado = await rpc(dono.token, "create_manual_order", {
    p_business_id: biz,
    p_items: [{ menu_item_id: item, qty: 1, price: 1 }],
    p_consumption_option: "para_levar", p_concluir: true,
  });
  const idForjado = typeof forjado.corpo === "string" ? forjado.corpo : null;
  const totalForjado = (await tabela(dono.token, `orders?select=total&id=eq.${idForjado}`)).corpo?.[0]?.total;
  Number(totalForjado) === PRECO
    ? ok("o `price` enviado foi ignorado", `${PRECO}, nao 1`)
    : ko("ACEITOU O PRECO DO ECRA", `${totalForjado}`);

  const artigoAlheio = await rpc(dono.token, "create_manual_order", {
    p_business_id: biz,
    p_items: [{ name: "Nao existe neste menu", qty: 1 }],
    p_consumption_option: "para_levar",
  });
  artigoAlheio.status >= 400 ? ok("artigo fora do menu e recusado") : ko("aceitou artigo inexistente");

  // --- 3. pedido manual COM entrega --------------------------------------
  console.log("\n3. Pedido manual com entrega (decisao 2)");
  const comEntrega = await rpc(dono.token, "create_manual_order", {
    p_business_id: biz,
    p_items: [{ menu_item_id: item, qty: 1 }],
    p_consumption_option: "entrega",
    p_customer_name: "Sr. Mane", p_customer_phone: "955111222",
    p_bairro: BAIRRO, p_address: "Casa do lado da mesquita",
    p_payment_method: "entrega",
  });
  const idEntrega = typeof comEntrega.corpo === "string" ? comEntrega.corpo : null;
  idEntrega ? ok("pedido manual com entrega criado") : ko("falhou", erro(comEntrega));
  if (!idEntrega) return;

  const oEntrega = (await tabela(dono.token, `orders?select=status,fleet_id,delivery_fee,source&id=eq.${idEntrega}`)).corpo?.[0];
  oEntrega?.fleet_id && Number(oEntrega.delivery_fee) === TAXA
    ? ok("frota e taxa resolvidas como num pedido da app", `${TAXA} FCFA`)
    : ko("sem frota/taxa", JSON.stringify(oEntrega));

  const semConcluir = await rpc(dono.token, "create_manual_order", {
    p_business_id: biz, p_items: [{ menu_item_id: item, qty: 1 }],
    p_consumption_option: "entrega", p_bairro: BAIRRO, p_concluir: true,
  });
  semConcluir.status >= 400
    ? ok("nao se conclui na criacao um pedido com entrega")
    : ko("concluiu um pedido de entrega sem motorista nenhum");

  // Levar ate ao fim pelo caminho real.
  await rpc(dono.token, "update_order_status", { p_order_id: idEntrega, p_new_status: "em_preparacao" });
  await rpc(dono.token, "update_order_status", { p_order_id: idEntrega, p_new_status: "pronto" });
  const entregaId = (await tabela(dono.token, `deliveries?select=id&order_id=eq.${idEntrega}`)).corpo?.[0]?.id;
  entregaId ? ok("entrega criada e oferecida a frota") : ko("sem entrega");
  await rpc(motorista.token, "accept_delivery", { p_delivery_id: entregaId });
  await rpc(motorista.token, "pickup_delivery", { p_delivery_id: entregaId });
  const fim = await rpc(motorista.token, "complete_delivery", { p_delivery_id: entregaId });
  fim.status < 300 ? ok("motorista concluiu a entrega") : ko("complete_delivery falhou", erro(fim));

  // --- 4. O PONTO DELICADO: isentar comissao sem isentar o §28 -----------
  console.log("\n4. Isencao cirurgica: comissao nao, divida de comida sim");
  c = await comissao();
  const f = await financasFrota();

  Number(c.commission_due) === 0
    ? ok("restaurante: comissao continua a ZERO", "nem sobre a comida")
    : ko("gerou comissao de restaurante", `${c.commission_due}`);
  // DECISAO CORRIGIDA (2026-09-16): a frota PAGA comissao no pedido manual com
  // entrega. O restaurante nao usou a plataforma para arranjar o cliente; a
  // frota usou-a para entregar. Sao duas perguntas diferentes.
  const comissaoFrotaEsperada = Math.round(TAXA * 5 / 100);
  Number(f.comissao_gerada) === comissaoFrotaEsperada
    ? ok(`frota: comissao de ${comissaoFrotaEsperada} sobre a taxa de entrega (§26)`, "5% de " + TAXA)
    : ko("comissao da frota errada", `${f.comissao_gerada}, esperava ${comissaoFrotaEsperada}`);

  // E agora o que NAO pode ter desaparecido.
  Number(c.food_receivable) === PRECO
    ? ok(`restaurante TEM ${PRECO} a receber da frota (§28)`, "isto nao e comissao")
    : ko("A DIVIDA DE COMIDA DESAPARECEU", `${c.food_receivable} — dinheiro do restaurante perdido`);
  Number(f.divida_restaurantes) === PRECO
    ? ok(`frota DEVE ${PRECO} ao restaurante (§28)`)
    : ko("a frota nao ficou a dever nada", `${f.divida_restaurantes}`);

  // O par da partida dobrada do §28, e NADA de comissao. O restaurante ve as
  // duas linhas do par porque ambas o identificam -- e dinheiro dele, dos dois
  // lados da mesma transaccao.
  const linhas = (await tabela(dono.token, `ledger_entries?select=entry_type&order_id=eq.${idEntrega}`)).corpo ?? [];
  const tipos = linhas.map((l) => l.entry_type).sort();
  JSON.stringify(tipos) === JSON.stringify(["credito_comida", "divida_comida"])
    ? ok("ledger: so o par da divida de comida", JSON.stringify(tipos))
    : ko("linhas de ledger inesperadas", JSON.stringify(tipos));

  // CUIDADO A LER ISTO: esta consulta e feita com o JWT do RESTAURANTE, que nao
  // ve as linhas da conta da frota (`comissao_frota` nao traz business_id).
  // Portanto isto prova que o RESTAURANTE nao foi cobrado -- nao prova nada
  // sobre a frota. A frota verifica-se a seguir, com o token dela.
  tipos.some((t) => t === "comissao_restaurante")
    ? ko("HA COMISSAO DE RESTAURANTE num pedido manual", JSON.stringify(tipos))
    : ok("no ledger do restaurante nao ha `comissao_restaurante` (§25)");

  const linhasFrota = (await tabela(frota.token, `ledger_entries?select=entry_type,amount&order_id=eq.${idEntrega}&entry_type=eq.comissao_frota`)).corpo ?? [];
  linhasFrota.length === 1 && Number(linhasFrota[0].amount) === comissaoFrotaEsperada
    ? ok("no ledger da frota HA `comissao_frota` (§26)", `${linhasFrota[0].amount} FCFA`)
    : ko("a comissao da frota nao foi escrita", JSON.stringify(linhasFrota));

  // E o fecho de caixa da Fase 2.3 tem de funcionar sobre isto.
  const fecho = (await rpc(frota.token, "get_fleet_cash_closing")).corpo ?? {};
  (fecho.restaurantes ?? []).some((r) => Number(r.divida_aberta) === PRECO)
    ? ok("o pedido manual aparece no fecho de caixa da frota (Fase 2.3)")
    : ko("nao aparece no fecho de caixa", JSON.stringify(fecho.restaurantes));

  // --- 5. stock: manual e app disputam a mesma unidade -------------------
  console.log("\n5. Concorrencia entre pedido manual e pedido da app");
  await rpc(dono.token, "set_menu_item_stock", { p_menu_item_id: item, p_stock_qty: 1 });
  const [manual, app] = await Promise.all([
    rpc(dono.token, "create_manual_order", {
      p_business_id: biz, p_items: [{ menu_item_id: item, qty: 1 }],
      p_consumption_option: "para_levar",
    }),
    rpc(cliente.token, "create_order", {
      p_business_id: biz, p_customer_id: cliente.user_id,
      p_customer_name: "Cliente App", p_customer_phone: "955333444",
      p_items: [{ menu_item_id: item, name: NOME, price: PRECO, qty: 1 }],
      p_total: PRECO, p_consumption_option: "comer_no_local", p_payment_method: "entrega",
    }),
  ]);
  const ganharam = [manual, app].filter((r) => r.status < 300).length;
  ganharam === 1
    ? ok("exactamente um ganhou a ultima unidade", `manual ${manual.status}, app ${app.status}`)
    : ko(`VENDIDO A MAIS: ${ganharam} ganharam`, `manual ${manual.status}, app ${app.status}`);
  const stockFinal = (await tabela(dono.token, `menu_items?select=stock_qty&id=eq.${item}`)).corpo?.[0]?.stock_qty;
  Number(stockFinal) === 0 ? ok("stock ficou em 0") : ko("stock final errado", `${stockFinal}`);

  // --- 6. isolamento -------------------------------------------------------
  console.log("\n6. Isolamento (§46)");
  const alheio = await rpc(estranho.token, "create_manual_order", {
    p_business_id: biz, p_items: [{ menu_item_id: item, qty: 1 }],
    p_consumption_option: "para_levar",
  });
  alheio.status >= 400
    ? ok("outro dono nao lanca pedidos no restaurante alheio")
    : ko("ISOLAMENTO QUEBRADO: lancou pedido noutro restaurante");

  const cliForja = await rpc(cliente.token, "create_manual_order", {
    p_business_id: biz, p_items: [{ menu_item_id: item, qty: 1 }],
    p_consumption_option: "para_levar",
  });
  cliForja.status >= 400 ? ok("cliente nao lanca pedidos manuais") : ko("cliente lancou pedido manual");

  // O caminho que interessa fechar: marcar um pedido NORMAL como manual para
  // fugir a comissao.
  const marcar = await tabela(cliente.token, `orders?id=eq.${idBalcao}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ source: "manual" }),
  });
  marcar.status >= 400
    ? ok("ninguem marca um pedido como manual a mao", `HTTP ${marcar.status}`)
    : ko("PODE FUGIR A COMISSAO marcando o pedido como manual", `HTTP ${marcar.status}`);

  const marcarDono = await tabela(dono.token, `orders?id=eq.${idBalcao}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ source: "manual" }),
  });
  marcarDono.status >= 400
    ? ok("nem o proprio dono escreve `source` directamente", `HTTP ${marcarDono.status}`)
    : ko("O DONO PODE MARCAR QUALQUER PEDIDO COMO MANUAL", `HTTP ${marcarDono.status}`);

  const anon = await fetch(`${URL_BASE}/rest/v1/rpc/create_manual_order`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ p_business_id: biz, p_items: [], p_consumption_option: "para_levar" }),
  });
  anon.status >= 400 ? ok("anonimo recusado", `HTTP ${anon.status}`) : ko("anonimo passou");

  console.log(`\n  SQL de limpeza (privilegio de admin):`);
  console.log(`    DELETE FROM auth.users WHERE email LIKE 'rlstest-%@deliveryapp.test';\n`);
}

main()
  .catch((err) => ko("ERRO", err.message))
  .finally(() => {
    console.log(`\n${passou} passou, ${falhou} falhou\n`);
    process.exit(falhou > 0 ? 1 : 0);
  });
