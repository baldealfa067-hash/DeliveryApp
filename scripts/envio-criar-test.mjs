#!/usr/bin/env node
/**
 * FASE 7.2 — criar um envio, por HTTP real com JWT de utilizador normal.
 *
 * A partir daqui nao ha privilegio nenhum: a RPC `create_send_order` e o
 * caminho publico, e este teste percorre-o de ponta a ponta como um cliente
 * faria — criar, ser oferecido a frota certa, aceitar, recolher, entregar, e
 * ver o ledger no fim.
 *
 * O QUE ISTO TEM DE PROVAR, e onde e facil enganar-se:
 *
 *  1. MESMO DISPATCH, sem tubo paralelo (§19). Nao basta a entrega existir:
 *     tem de haver `dispatch_attempts` aberto, o motorista DESTA frota tem de a
 *     ver, e a de outra frota nao.
 *
 *  2. O LEDGER TEM DE SAIR CERTO SOZINHO. Um envio tem total 0, e e' isso que
 *     faz o ledger escrever SO a comissao da frota (§26) -- sem comissao de
 *     restaurante (§25) e sem divida de comida (§28), que nao existem aqui.
 *     Verifica-se a lista de tipos, nao "correu sem erro".
 *
 *  3. RECUSAR SEM FROTA (§14). Sem frota nao ha preco para o cliente aceitar, e
 *     um envio sem frota ficaria presa para sempre sem ninguem dar por ela.
 *
 *  4. DUPLO TOQUE (§73). Dois pedidos iguais seguidos devolvem o MESMO envio,
 *     em vez de criarem dois.
 *
 *   node scripts/envio-criar-test.mjs
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
const DESTINO = `Safim${MARCA.slice(-6)}`;
const TAXA = 2500;
let passou = 0, falhou = 0;
const ok = (n, d = "") => { passou++; console.log(`  \x1b[32m✓\x1b[0m ${n}${d ? ` — ${d}` : ""}`); };
const ko = (n, d = "") => { falhou++; console.log(`  \x1b[31m✗\x1b[0m ${n}${d ? ` — ${d}` : ""}`); };

async function signup(etq) {
  const r = await fetch(`${URL_BASE}/auth/v1/signup`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: `${MARCA}-${etq}@deliveryapp.test`, password: "TesteEnvio#2026", data: { name: etq } }),
  });
  const c = await r.json();
  if (!c.access_token) throw new Error(`signup ${etq}: ${JSON.stringify(c).slice(0,200)}`);
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

const ENVIO = {
  p_send_item_type: "documento",
  p_description: "Envelope com documentos da camara",
  p_pickup_address: "Mercado de Bandim, banca do Sr. Mane",
  p_pickup_bairro: "Bandim",
  p_pickup_voice_note_url: "https://exemplo.test/recolha.webm",
  p_address: "Casa azul depois da bomba, perguntar por Ndala",
  p_customer_name: "Cliente Envio",
  p_customer_phone: "955123456",
  p_voice_note_url: "https://exemplo.test/entrega.webm",
  p_pickup_lat: 11.8636, p_pickup_lng: -15.5977,
  p_customer_lat: 11.9500, p_customer_lng: -15.6500,
  p_payment_method: "entrega",
};

async function main() {
  console.log(`\nFASE 7.2 — criar um envio (${MARCA})\n`);
  console.log("Preparacao");

  const cliente = await signup("cliente");
  const frota = await signup("frota");
  const motorista = await signup("motorista");
  const outraFrota = await signup("outrafrota");
  const outroMotorista = await signup("outromotorista");

  await rpc(frota.token, "create_fleet", { p_name: `Frota ${MARCA}`, p_phone: `9${String(Date.now()).slice(-7)}` });
  await rpc(frota.token, "upsert_zone_price", { p_bairro: DESTINO, p_preco: TAXA });
  await rpc(outraFrota.token, "create_fleet", { p_name: `Outra ${MARCA}`, p_phone: `9${String(Date.now()+3).slice(-7)}` });

  for (const [f, m, nome] of [[frota, motorista, "Motorista A"], [outraFrota, outroMotorista, "Motorista B"]]) {
    const tel = `9${String(Date.now() + Math.floor(Math.random()*900)).slice(-7)}`;
    await tabela(m.token, `profiles?user_id=eq.${m.user_id}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ phone: tel }),
    });
    await rpc(f.token, "add_driver_to_fleet", { p_phone: tel, p_name: nome });
    await rpc(m.token, "toggle_driver_availability");
  }
  ok("duas frotas, um motorista em cada");

  // --- 1. preco antes de confirmar (§14) ---------------------------------
  console.log("\n1. O cliente ve o preco antes de confirmar (§14)");
  const preco = await rpc(cliente.token, "get_delivery_price", { p_bairro: DESTINO });
  Number(preco.corpo?.[0]?.preco) === TAXA
    ? ok("preco consultavel pelo cliente", `${TAXA} FCFA, frota "${preco.corpo[0].fleet_name}"`)
    : ko("o cliente nao consegue ver o preco", erro(preco));

  // --- 2. recusa sem frota ------------------------------------------------
  console.log("\n2. Bairro que ninguem serve");
  const semFrota = await rpc(cliente.token, "create_send_order", { ...ENVIO, p_bairro: `Nenhures${MARCA.slice(-5)}` });
  semFrota.status >= 400 && /nenhuma frota/i.test(erro(semFrota))
    ? ok("recusado, com a razao dita ao cliente", "sem frota nao ha preco para aceitar")
    : ko("ACEITOU um envio sem frota", `HTTP ${semFrota.status}`);

  // --- 3. validacoes ------------------------------------------------------
  console.log("\n3. Validacoes");
  for (const [campo, args, etiq] of [
    ["tipo",     { p_send_item_type: "carro" },      "tipo de envio invalido"],
    ["recolha",  { p_pickup_address: "   " },        "sem morada de recolha"],
    ["destino",  { p_address: "" },                  "sem morada de entrega"],
    ["telefone", { p_customer_phone: " " },          "sem telefone"],
    ["pagamento",{ p_payment_method: "cartao" },     "metodo de pagamento invalido"],
    // §23: o pagamento online usa o merchant_code do PARCEIRO, e um envio nao
    // tem parceiro nenhum. Aceitar 'online' prometia um caminho inexistente.
    ["online",   { p_payment_method: "online" },     "pagamento online num envio"],
  ]) {
    const r = await rpc(cliente.token, "create_send_order", { ...ENVIO, p_bairro: DESTINO, ...args });
    r.status >= 400 ? ok(`recusa: ${etiq}`) : ko(`aceitou ${etiq}`);
  }

  // --- 4. criar --------------------------------------------------------
  console.log("\n4. Criar o envio");
  const criado = await rpc(cliente.token, "create_send_order", { ...ENVIO, p_bairro: DESTINO });
  const r = criado.corpo ?? {};
  r.order_id ? ok("envio criado", `#${r.order_number}`) : ko("create_send_order falhou", erro(criado));
  if (!r.order_id) return;

  Number(r.delivery_fee) === TAXA ? ok(`preco congelado no pedido: ${TAXA}`) : ko("preco errado", `${r.delivery_fee}`);
  r.motoristas_notificados === 1
    ? ok("1 motorista notificado — so o da frota que cobre o destino")
    : ko("notificacao a mais ou a menos", `${r.motoristas_notificados}`);
  r.repetido === false ? ok("marcado como pedido novo") : ko("veio marcado como repetido");

  const o = (await tabela(cliente.token,
    `orders?select=kind,business_id,total,status,consumption_option,pickup_address,pickup_bairro,pickup_lat,send_item_type,notes,voice_note_url,pickup_voice_note_url&id=eq.${r.order_id}`)).corpo?.[0];
  o?.kind === "envio" && o?.business_id === null && Number(o?.total) === 0
    ? ok("kind=envio, sem restaurante, total 0", "o que o CHECK da 7.1 exige")
    : ko("pedido mal formado", JSON.stringify(o));
  o?.status === "aguardando_motorista"
    ? ok("nasce em `aguardando_motorista`", "sem passar pela matriz")
    : ko("estado inicial errado", o?.status);
  o?.pickup_address?.includes("Bandim") && o?.pickup_bairro === "Bandim" && o?.pickup_lat
    ? ok("origem guardada, com GPS")
    : ko("origem incompleta", JSON.stringify(o));
  o?.notes?.includes("camara") ? ok("descricao guardada") : ko("descricao perdida", o?.notes);
  o?.voice_note_url && o?.pickup_voice_note_url && o.voice_note_url !== o.pickup_voice_note_url
    ? ok("duas vozes distintas chegaram ao pedido (§21)")
    : ko("vozes em falta ou iguais");

  // --- 5. O MESMO dispatch -------------------------------------------------
  console.log("\n5. O mesmo dispatch das Fases 3 e 5 (§19)");
  const rondas = (await tabela(cliente.token, `dispatch_attempts?select=attempt_number,outcome,drivers_notified&order_id=eq.${r.order_id}`)).corpo ?? [];
  // O cliente nao tem policy em dispatch_attempts; le-se pelo motorista abaixo.
  const disp = await rpc(motorista.token, "get_available_deliveries");
  const linha = (disp.corpo ?? []).find((d) => d.order_id === r.order_id);
  linha ? ok("o motorista da frota ve o envio") : ko("O MOTORISTA NAO VE O ENVIO", JSON.stringify(disp.corpo ?? []).slice(0,200));
  linha?.restaurant_name === "Mercado de Bandim, banca do Sr. Mane"
    ? ok("no lugar do restaurante aparece o ponto de recolha")
    : ko("ponto de recolha errado", String(linha?.restaurant_name));
  linha && Number(linha.delivery_fee) === TAXA ? ok("o motorista ve a taxa certa") : ko("taxa errada para o motorista");
  linha && linha.voice_note_url ? ok("a voz da entrega chega ao motorista") : ko("voz nao chega ao motorista");
  // FASE 7.3: a voz da RECOLHA e a mais util das duas -- e o primeiro sitio
  // onde o motorista tem de chegar, e o mais dificil de explicar por escrito.
  // Estava a ser gravada e nao era devolvida a ninguem.
  linha && linha.pickup_voice_note_url === ENVIO.p_pickup_voice_note_url
    ? ok("a voz da RECOLHA chega ao motorista (§21)")
    : ko("a voz da recolha nao chega", String(linha?.pickup_voice_note_url));
  linha && linha.pickup_voice_note_url !== linha.voice_note_url
    ? ok("as duas vozes chegam separadas")
    : ko("as vozes vieram iguais ou em falta");
  linha && linha.distance_km !== null && Number(linha.distance_km) > 0
    ? ok("distancia calculada (§40)", `${linha.distance_km} km`)
    : ko("distancia nao calculada apesar de haver GPS dos dois lados", String(linha?.distance_km));

  const dispOutra = await rpc(outroMotorista.token, "get_available_deliveries");
  ((dispOutra.corpo ?? []).filter((d) => d.order_id === r.order_id)).length === 0
    ? ok("a outra frota NAO ve o envio (§46)")
    : ko("ISOLAMENTO QUEBRADO entre frotas");

  // --- 6. duplo toque (§73) ------------------------------------------------
  console.log("\n6. Duplo toque");
  const outraVez = await rpc(cliente.token, "create_send_order", { ...ENVIO, p_bairro: DESTINO });
  outraVez.corpo?.repetido === true && outraVez.corpo?.order_id === r.order_id
    ? ok("o segundo toque devolve o MESMO envio", "nao cria um segundo (§73)")
    : ko("CRIOU UM SEGUNDO ENVIO", JSON.stringify(outraVez.corpo).slice(0,160));

  const quantos = (await tabela(cliente.token, `orders?select=id&kind=eq.envio&customer_id=eq.${cliente.user_id}`)).corpo ?? [];
  quantos.length === 1 ? ok("existe exactamente 1 envio deste cliente") : ko("envios a mais", `${quantos.length}`);

  // --- 7. percurso completo -------------------------------------------------
  console.log("\n7. Percurso do motorista, ate ao fim");
  const entregaId = linha.id;
  const aceitar = await rpc(motorista.token, "accept_delivery", { p_delivery_id: entregaId });
  aceitar.status < 300 ? ok("aceitar") : ko("accept_delivery falhou", erro(aceitar));
  const minhas = await rpc(motorista.token, "get_my_deliveries");
  const minha = (minhas.corpo ?? []).find((d) => d.order_id === r.order_id);
  minha?.pickup_voice_note_url
    ? ok("a voz da recolha tambem em `get_my_deliveries`")
    : ko("a voz da recolha perde-se depois de aceitar");

  const recolher = await rpc(motorista.token, "pickup_delivery", { p_delivery_id: entregaId });
  recolher.status < 300 ? ok("recolher") : ko("pickup_delivery falhou", erro(recolher));
  // FASE 9.3: concluir exige prova (codigo OU foto). O caminho realista e o
  // do codigo: quem o tem da-o ao motorista, que o valida -- e a validacao
  // regista a prova e conclui. `complete_delivery` sozinho ja nao conclui.
  const codigo = (await tabela(cliente.token, `orders?select=delivery_code&id=eq.${r.order_id}`)).corpo?.[0]?.delivery_code;
  const concluir = await rpc(motorista.token, "validate_delivery_code", { p_delivery_id: entregaId, p_code: codigo });
  concluir.corpo === true ? ok("entregar", "com o codigo do cliente") : ko("validacao do codigo falhou", erro(concluir));

  const fim = (await tabela(cliente.token, `orders?select=status&id=eq.${r.order_id}`)).corpo?.[0]?.status;
  fim === "concluido" ? ok("o envio ficou `concluido`") : ko("estado final errado", fim);

  // --- 8. o ledger ---------------------------------------------------------
  console.log("\n8. Ledger: so a comissao da frota");
  const fin = (await rpc(frota.token, "get_fleet_financials")).corpo ?? {};
  const esperado = Math.round(TAXA * 5 / 100);
  Number(fin.comissao_gerada) === esperado
    ? ok(`frota deve ${esperado} de comissao (§26)`, `5% de ${TAXA}`)
    : ko("comissao da frota errada", `${fin.comissao_gerada}, esperava ${esperado}`);
  Number(fin.divida_restaurantes) === 0
    ? ok("nenhuma divida de comida (§28)", "num envio nao ha comida nem restaurante")
    : ko("APARECEU DIVIDA DE COMIDA", `${fin.divida_restaurantes}`);

  const linhas = (await tabela(frota.token, `ledger_entries?select=entry_type&order_id=eq.${r.order_id}`)).corpo ?? [];
  const tipos = [...new Set(linhas.map((l) => l.entry_type))].sort();
  JSON.stringify(tipos) === JSON.stringify(["comissao_frota"])
    ? ok("no ledger existe SO `comissao_frota`", JSON.stringify(tipos))
    : ko("tipos de ledger inesperados", JSON.stringify(tipos));

  // --- 9. isolamento --------------------------------------------------------
  console.log("\n9. Isolamento (§46)");
  const estranho = await signup("estranho");
  const leAlheio = await tabela(estranho.token, `orders?select=id&id=eq.${r.order_id}`);
  (leAlheio.corpo ?? []).length === 0 ? ok("outro cliente nao ve o envio") : ko("ISOLAMENTO QUEBRADO");

  const anon = await fetch(`${URL_BASE}/rest/v1/rpc/create_send_order`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ ...ENVIO, p_bairro: DESTINO }),
  });
  anon.status >= 400 ? ok("anonimo nao cria envios", `HTTP ${anon.status}`) : ko("anonimo criou um envio");

  console.log(`\n  SQL de limpeza (privilegio de admin):`);
  console.log(`    DELETE FROM auth.users WHERE email LIKE 'rlstest-%@deliveryapp.test';\n`);
}

main()
  .catch((err) => ko("ERRO", err.message))
  .finally(() => {
    console.log(`\n${passou} passou, ${falhou} falhou\n`);
    process.exit(falhou > 0 ? 1 : 0);
  });
