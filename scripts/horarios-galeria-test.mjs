#!/usr/bin/env node
/**
 * FASE 2.5 — horarios e galeria, por HTTP real com JWT de utilizador normal.
 *
 * OS SITIOS ONDE ISTO SE PARTE, e por isso o que aqui se mede:
 *
 *  1. TRAVESSIA DA MEIA-NOITE. Um restaurante que abre as 19:00 e fecha as
 *     02:00 esta aberto a 01:00 de SABADO por causa da linha de SEXTA. E o caso
 *     que uma comparacao ingenua (`hora BETWEEN abre AND fecha`) erra sempre, e
 *     erra em silencio -- fecha a loja a meio da noite de mais movimento.
 *
 *  2. O DEFAULT TEM DE SER ABERTO. Ha restaurantes reais em producao que nunca
 *     vao abrir este ecra. Se "sem horario" fosse "fechado", a migracao
 *     fechava-os a todos.
 *
 *  3. O TRAVAO TEM DE ESTAR NO BACKEND (§46). Testa-se chamando o create_order
 *     directamente, que e o que um cliente com o telemovel na mao pode fazer
 *     mesmo com o botao desligado no ecra.
 *
 *  4. O PEDIDO MANUAL NAO PODE SER TRAVADO -- quem o lanca e o dono.
 *
 *   node scripts/horarios-galeria-test.mjs
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
const PRECO = 3000;
let passou = 0, falhou = 0;
const ok = (n, d = "") => { passou++; console.log(`  \x1b[32m✓\x1b[0m ${n}${d ? ` — ${d}` : ""}`); };
const ko = (n, d = "") => { falhou++; console.log(`  \x1b[31m✗\x1b[0m ${n}${d ? ` — ${d}` : ""}`); };

async function signup(etiqueta) {
  const r = await fetch(`${URL_BASE}/auth/v1/signup`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: `${MARCA}-${etiqueta}@deliveryapp.test`, password: "TesteHorario#2026", data: { name: etiqueta } }),
  });
  const c = await r.json();
  if (!c.access_token) throw new Error(`signup ${etiqueta}: ${JSON.stringify(c)}`);
  return { token: c.access_token, user_id: c.user.id };
}
const rpc = async (token, nome, args = {}) => {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${nome}`, {
    method: "POST",
    headers: { apikey: ANON, ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  let corpo = null; try { corpo = await r.json(); } catch { /* 204 */ }
  return { status: r.status, corpo };
};
const tabela = async (token, caminho, init = {}) => {
  const r = await fetch(`${URL_BASE}/rest/v1/${caminho}`, {
    ...init,
    headers: { apikey: ANON, ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  let corpo = null; try { corpo = await r.json(); } catch { /* vazio */ }
  return { status: r.status, corpo };
};
const erro = (r) => JSON.stringify(r.corpo?.message ?? r.corpo ?? "").slice(0, 160);

// Um instante concreto, em UTC (a Guine-Bissau e UTC+0).
const quando = (diaSemana, hhmm) => {
  // 2026-09-13 foi um DOMINGO. Somar o dia da semana da o dia que se quer.
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(Date.UTC(2026, 8, 13 + diaSemana, h, m, 0));
  return d.toISOString();
};

async function main() {
  console.log(`\nFASE 2.5 — horarios e galeria (${MARCA})\n`);
  console.log("Preparacao");

  const dono = await signup("dono");
  const cliente = await signup("cliente");
  const estranho = await signup("estranho");
  await rpc(dono.token, "register_as_business");
  await rpc(estranho.token, "register_as_business");
  const biz = (await tabela(dono.token, `profiles?select=id&user_id=eq.${dono.user_id}`)).corpo?.[0]?.id;
  const bizOutro = (await tabela(estranho.token, `profiles?select=id&user_id=eq.${estranho.user_id}`)).corpo?.[0]?.id;
  if (!biz) throw new Error("sem perfil");

  const NOME = `Caldo ${MARCA}`;
  const item = (await tabela(dono.token, "menu_items", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ business_id: biz, name: NOME, price: PRECO }),
  })).corpo[0].id;
  ok("restaurante e menu criados");

  const aberto = async (iso) =>
    (await rpc(cliente.token, "is_business_open", { p_business_id: biz, p_at: iso })).corpo;
  const encomendar = () => rpc(cliente.token, "create_order", {
    p_business_id: biz, p_customer_id: cliente.user_id,
    p_customer_name: "Cliente", p_customer_phone: "955777888",
    p_items: [{ menu_item_id: item, name: NOME, price: PRECO, qty: 1 }],
    p_total: PRECO, p_consumption_option: "comer_no_local", p_payment_method: "entrega",
  });

  // --- 1. sem horario = sempre aberto ------------------------------------
  console.log("\n1. Sem horario definido");
  (await aberto(quando(3, "03:00"))) === true
    ? ok("sempre aberto, mesmo as 3 da manha", "o default nao pode fechar quem nunca definiu")
    : ko("sem horario devolveu fechado", "isto fecharia todos os restaurantes existentes");
  const semHorario = await encomendar();
  semHorario.status < 300 ? ok("e aceita pedidos") : ko("recusou pedido sem horario definido", erro(semHorario));

  // --- 2. horario normal --------------------------------------------------
  console.log("\n2. Horario normal (seg-sex 08:00-18:00)");
  const semana = [1, 2, 3, 4, 5].map((d) => ({ weekday: d, opens_at: "08:00", closes_at: "18:00" }));
  const posto = await rpc(dono.token, "set_business_hours", { p_business_id: biz, p_horario: semana });
  Number(posto.corpo) === 5 ? ok("5 periodos gravados") : ko("set_business_hours falhou", erro(posto));

  (await aberto(quando(3, "12:00"))) === true ? ok("quarta as 12:00: aberto") : ko("quarta as 12:00 deu fechado");
  (await aberto(quando(3, "07:59"))) === false ? ok("quarta as 07:59: fechado") : ko("aberto antes de abrir");
  (await aberto(quando(3, "18:00"))) === false ? ok("quarta as 18:00: fechado", "o fecho e exclusivo") : ko("aberto a hora de fechar");
  (await aberto(quando(0, "12:00"))) === false ? ok("domingo: fechado", "nao ha linha para domingo") : ko("aberto num dia sem horario");

  // --- 3. A TRAVESSIA DA MEIA-NOITE --------------------------------------
  console.log("\n3. Periodo que atravessa a meia-noite (sexta 19:00 → 02:00)");
  await rpc(dono.token, "set_business_hours", {
    p_business_id: biz,
    p_horario: [{ weekday: 5, opens_at: "19:00", closes_at: "02:00" }],
  });
  (await aberto(quando(5, "20:00"))) === true ? ok("sexta as 20:00: aberto") : ko("sexta as 20:00 deu fechado");
  (await aberto(quando(5, "23:59"))) === true ? ok("sexta as 23:59: aberto") : ko("fechou antes da meia-noite");
  (await aberto(quando(6, "01:00"))) === true
    ? ok("SABADO as 01:00: aberto", "pela linha de sexta — o caso que se erra sempre")
    : ko("FECHOU A MEIO DA NOITE", "a travessia da meia-noite esta errada");
  (await aberto(quando(6, "02:00"))) === false ? ok("sabado as 02:00: fechado") : ko("nao fechou a hora certa");
  (await aberto(quando(6, "20:00"))) === false
    ? ok("sabado as 20:00: fechado", "sabado nao tem horario proprio")
    : ko("o periodo de sexta abriu o sabado inteiro");

  // --- 4. periodos partidos ----------------------------------------------
  console.log("\n4. Periodos partidos (almoco e jantar)");
  await rpc(dono.token, "set_business_hours", {
    p_business_id: biz,
    p_horario: [
      { weekday: 2, opens_at: "11:00", closes_at: "15:00" },
      { weekday: 2, opens_at: "18:00", closes_at: "23:00" },
    ],
  });
  (await aberto(quando(2, "12:00"))) === true ? ok("terca as 12:00: aberto (almoco)") : ko("almoco fechado");
  (await aberto(quando(2, "16:00"))) === false ? ok("terca as 16:00: fechado (entre periodos)") : ko("aberto entre periodos");
  (await aberto(quando(2, "20:00"))) === true ? ok("terca as 20:00: aberto (jantar)") : ko("jantar fechado");

  // Substituir, nao acumular.
  const contagem = (await tabela(dono.token, `business_hours?select=id&business_id=eq.${biz}`)).corpo ?? [];
  contagem.length === 2
    ? ok("gravar o horario SUBSTITUI o anterior", `${contagem.length} periodos, nao 8`)
    : ko("o horario acumulou", `${contagem.length} periodos`);

  // --- 5. o travao no pedido ---------------------------------------------
  console.log("\n5. Loja fechada nao aceita pedidos (§46)");
  await rpc(dono.token, "set_business_hours", {
    p_business_id: biz, p_horario: [{ weekday: 1, opens_at: "08:00", closes_at: "08:30" }],
  });
  const agoraAberto = (await rpc(cliente.token, "is_business_open", { p_business_id: biz })).corpo;
  const tentativa = await encomendar();
  if (agoraAberto === false) {
    tentativa.status >= 400 && /fechado/i.test(erro(tentativa))
      ? ok("pedido recusado pelo backend", "com a razao dita ao cliente")
      : ko("ACEITOU PEDIDO COM A LOJA FECHADA", `HTTP ${tentativa.status}`);
  } else {
    ko("o teste nao conseguiu pôr a loja fechada", "rever a janela escolhida");
  }

  // O dono continua a poder lancar a mao (decisao d).
  const manual = await rpc(dono.token, "create_manual_order", {
    p_business_id: biz, p_items: [{ menu_item_id: item, qty: 1 }],
    p_consumption_option: "para_levar", p_concluir: true,
  });
  manual.status < 300
    ? ok("o dono lanca pedido manual com a loja fechada", "quem lanca sabe se esta aberto")
    : ko("o pedido manual foi travado pelo horario", erro(manual));

  // --- 6. interruptor manual ----------------------------------------------
  console.log("\n6. Interruptor manual");
  await rpc(dono.token, "set_business_hours", { p_business_id: biz, p_horario: [] });
  (await rpc(cliente.token, "is_business_open", { p_business_id: biz })).corpo === true
    ? ok("horario limpo: volta a estar sempre aberto") : ko("continuou fechado sem horario");

  await rpc(dono.token, "set_accepting_orders", { p_business_id: biz, p_aceitar: false });
  (await rpc(cliente.token, "is_business_open", { p_business_id: biz })).corpo === false
    ? ok("interruptor desligado fecha, sem horario nenhum") : ko("o interruptor nao fechou");
  const comFechoManual = await encomendar();
  comFechoManual.status >= 400 ? ok("e o pedido e recusado") : ko("aceitou pedido com a loja desligada");

  await rpc(dono.token, "set_accepting_orders", { p_business_id: biz, p_aceitar: true });
  (await encomendar()).status < 300 ? ok("religar volta a aceitar") : ko("nao voltou a aceitar");

  // --- 7. galeria (reaproveita portfolio_images) -------------------------
  console.log("\n7. Galeria");
  const foto = await tabela(dono.token, "portfolio_images", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ provider_id: biz, image_url: `https://exemplo.test/${MARCA}.jpg`, caption: "Prato do dia" }),
  });
  foto.status < 300 ? ok("dono acrescenta foto a galeria") : ko("insercao falhou", erro(foto));
  const fotoId = foto.corpo?.[0]?.id;

  const publica = await tabela(null, `portfolio_images?select=image_url,caption&provider_id=eq.${biz}`);
  (publica.corpo ?? []).length === 1
    ? ok("a galeria e publica", "e a montra — o cliente ve antes de ter conta")
    : ko("anonimo nao ve a galeria", `HTTP ${publica.status}`);

  const alheia = await tabela(estranho.token, "portfolio_images", {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ provider_id: biz, image_url: "https://exemplo.test/intruso.jpg" }),
  });
  alheia.status >= 400
    ? ok("outro dono nao poe fotos na galeria alheia", `HTTP ${alheia.status}`)
    : ko("ISOLAMENTO QUEBRADO: escreveu na galeria alheia");

  const apagarAlheio = await tabela(estranho.token, `portfolio_images?id=eq.${fotoId}`, { method: "DELETE" });
  const aindaLa = (await tabela(null, `portfolio_images?select=id&id=eq.${fotoId}`)).corpo ?? [];
  aindaLa.length === 1
    ? ok("outro dono nao apaga foto alheia")
    : ko("ISOLAMENTO QUEBRADO: apagou foto alheia", `HTTP ${apagarAlheio.status}`);

  const apagar = await tabela(dono.token, `portfolio_images?id=eq.${fotoId}`, { method: "DELETE" });
  apagar.status < 300 ? ok("o dono apaga a sua foto") : ko("dono nao conseguiu apagar", erro(apagar));

  // --- 8. isolamento do horario -------------------------------------------
  console.log("\n8. Isolamento do horario (§46)");
  const horarioAlheio = await rpc(estranho.token, "set_business_hours", {
    p_business_id: biz, p_horario: [{ weekday: 0, opens_at: "00:00", closes_at: "23:59" }],
  });
  horarioAlheio.status >= 400
    ? ok("outro dono nao define o horario alheio")
    : ko("ISOLAMENTO QUEBRADO: definiu horario de outro restaurante");

  const fecharAlheio = await rpc(estranho.token, "set_accepting_orders", { p_business_id: biz, p_aceitar: false });
  fecharAlheio.status >= 400
    ? ok("outro dono nao fecha a loja alheia", "seria sabotagem trivial")
    : ko("ISOLAMENTO QUEBRADO: fechou a loja de outro");

  const escritaDirecta = await tabela(dono.token, "business_hours", {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ business_id: biz, weekday: 0, opens_at: "00:00", closes_at: "23:59" }),
  });
  escritaDirecta.status >= 400
    ? ok("nem o proprio dono escreve na tabela a mao", `HTTP ${escritaDirecta.status}`)
    : ko("escrita directa permitida — a validacao da RPC fica decorativa");

  const horarioPublico = await rpc(null, "get_business_hours", { p_business_id: biz });
  horarioPublico.status < 300 && horarioPublico.corpo?.business_id === biz
    ? ok("anonimo le o horario da loja", "e a montra")
    : ko("anonimo nao le o horario", `HTTP ${horarioPublico.status}`);

  console.log(`\n  SQL de limpeza (privilegio de admin):`);
  console.log(`    DELETE FROM auth.users WHERE email LIKE 'rlstest-%@deliveryapp.test';\n`);
}

main()
  .catch((err) => ko("ERRO", err.message))
  .finally(() => {
    console.log(`\n${passou} passou, ${falhou} falhou\n`);
    process.exit(falhou > 0 ? 1 : 0);
  });
