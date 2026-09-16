#!/usr/bin/env node
/**
 * FASE 2.2 — alerta de entrega presa, de ponta a ponta e em tempo real.
 *
 * PORQUE ISTO DEMORA ~22 MINUTOS, e porque nao se acelera. A expiracao corre
 * por `pg_cron` ao minuto e le' `platform_settings.dispatch_timeout_minutes`,
 * que esta' em 10. Havia duas maneiras de nao esperar:
 *
 *   a) chamar `expire_stale_dispatch()` a mao -- o EXECUTE esta revogado a
 *      `authenticated` de proposito, e chama-la por `service_role` provava
 *      apenas que a funcao corre, nao que o AGENDADOR a corre;
 *   b) baixar `dispatch_timeout_minutes` -- e' uma definicao GLOBAL, em
 *      producao, e mexer-lhe afectava pedidos reais a decorrer.
 *
 * Nenhuma das duas mede o que interessa: que uma entrega abandonada gera
 * mesmo um aviso, sozinha, sem ninguem a olhar (§71, §72). Por isso espera-se.
 *
 * SALVAGUARDA: aborta antes de comecar se encontrar rondas de dispatch abertas
 * que nao sejam nossas, para o relogio deste teste nao se confundir com
 * operacao real a decorrer.
 *
 *   node scripts/alertas-dispatch-test.mjs
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
const BAIRRO = `ZonaTeste${Date.now() % 100000}`;
let passou = 0, falhou = 0;
const ok = (n, d = "") => { passou++; console.log(`  \x1b[32m✓\x1b[0m ${n}${d ? ` — ${d}` : ""}`); };
const ko = (n, d = "") => { falhou++; console.log(`  \x1b[31m✗\x1b[0m ${n}${d ? ` — ${d}` : ""}`); };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const hora = () => new Date().toTimeString().slice(0, 8);

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

const avisos = async (conta, tipo) =>
  ((await rpc(conta.token, "get_my_notifications", { p_limit: 200 })).corpo ?? [])
    .filter((n) => !tipo || n.type === tipo);

async function main() {
  console.log(`\nFASE 2.2 — entrega presa, de ponta a ponta (${MARCA})`);
  console.log(`Inicio ${hora()} — isto demora ~22 minutos por desenho.\n`);

  console.log("Preparacao");
  const dono = await signup("dono");
  const cliente = await signup("cliente");
  const frota = await signup("frota");
  const motorista = await signup("motorista");

  // SALVAGUARDA (§19 do documento mestre, e a regra de limpeza): se houver
  // dispatch aberto que nao e' nosso, ha operacao real a decorrer -- sair.
  const abertas = await tabela(dono.token, "dispatch_attempts?select=id&outcome=eq.pendente");
  if (Array.isArray(abertas.corpo) && abertas.corpo.length > 0) {
    console.log(`\n  ABORTADO: ha ${abertas.corpo.length} ronda(s) de dispatch abertas que nao sao deste teste.`);
    console.log("  Correr com a operacao parada, para nao confundir dados reais com os do teste.\n");
    process.exit(2);
  }
  ok("nenhuma ronda de dispatch real aberta", "seguro prosseguir");

  await rpc(dono.token, "register_as_business");
  const biz = (await tabela(dono.token, `profiles?select=id&user_id=eq.${dono.user_id}`)).corpo?.[0]?.id;
  if (!biz) throw new Error("sem perfil de restaurante");

  // GPS DOS DOIS LADOS, senao nao ha entrega nenhuma. O update_order_status so
  // cria a linha de `deliveries` quando tem coordenadas do restaurante E do
  // cliente (usa-as para a distancia, §40). Sem elas o pedido vai na mesma para
  // `aguardando_motorista` e fica preso para sempre sem entrega associada --
  // ver a nota no relatorio da Fase 2.2.
  await tabela(dono.token, `profiles?user_id=eq.${dono.user_id}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ lat: 11.8636, lng: -15.5977 }),
  });

  const NOME = `Bianda ${MARCA}`;
  const item = (await tabela(dono.token, "menu_items", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ business_id: biz, name: NOME, price: 3000 }),
  })).corpo[0].id;

  // Frota com preco para o bairro do teste.
  const telFrota = `9${String(Date.now()).slice(-7)}`;
  const f = await rpc(frota.token, "create_fleet", { p_name: `Frota ${MARCA}`, p_phone: telFrota });
  f.status < 300 ? ok("frota criada") : ko("create_fleet falhou", JSON.stringify(f.corpo).slice(0, 160));

  const z = await rpc(frota.token, "upsert_zone_price", { p_bairro: BAIRRO, p_preco: 1500 });
  z.status < 300 ? ok(`preco de zona definido`, `${BAIRRO} = 1500 FCFA`) : ko("upsert_zone_price falhou", JSON.stringify(z.corpo).slice(0, 160));

  // Motorista: o add_driver_to_fleet procura por telefone no perfil.
  const telMot = `9${String(Date.now() + 7).slice(-7)}`;
  await tabela(motorista.token, `profiles?user_id=eq.${motorista.user_id}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ phone: telMot }),
  });
  const add = await rpc(frota.token, "add_driver_to_fleet", { p_phone: telMot, p_name: "Motorista Teste" });
  add.status < 300 ? ok("motorista associado a frota") : ko("add_driver_to_fleet falhou", JSON.stringify(add.corpo).slice(0, 160));

  // TEM DE FICAR DISPONIVEL: sem nenhum motorista disponivel a ronda nasce
  // 'sem_motoristas' (fechada) e nunca expira -- o teste mediria silencio e
  // chamar-lhe-ia sucesso.
  const disp = await rpc(motorista.token, "toggle_driver_availability");
  disp.corpo === true ? ok("motorista disponivel") : ko("motorista nao ficou disponivel", JSON.stringify(disp.corpo).slice(0, 160));

  // Pedido com entrega para o bairro da frota.
  const ord = await rpc(cliente.token, "create_order", {
    p_business_id: biz, p_customer_id: cliente.user_id,
    p_customer_name: "Cliente Teste", p_customer_phone: "955000555",
    p_items: [{ menu_item_id: item, name: NOME, price: 3000, qty: 1 }],
    p_total: 3000, p_consumption_option: "entrega", p_bairro: BAIRRO,
    p_address: "Casa amarela perto da escola", p_payment_method: "entrega",
    p_customer_lat: 11.8701, p_customer_lng: -15.6012,
  });
  const pedidoId = typeof ord.corpo === "string" ? ord.corpo : null;
  pedidoId ? ok("pedido de entrega criado") : ko("create_order falhou", JSON.stringify(ord.corpo).slice(0, 200));
  if (!pedidoId) return;

  const numero = (await tabela(dono.token, `orders?select=order_number,fleet_id,delivery_fee&id=eq.${pedidoId}`)).corpo?.[0];
  numero?.fleet_id ? ok("frota resolvida no checkout", `taxa ${numero.delivery_fee} FCFA`) : ko("pedido sem frota", JSON.stringify(numero));

  // Nao se pede `aguardando_motorista` a mao: marcar `pronto` num pedido de
  // entrega ja' o faz sozinho la dentro (e' onde a entrega nasce e e' oferecida
  // a frota). Pedi-lo explicitamente dava
  // "Transicao invalida: aguardando_motorista -> aguardando_motorista".
  for (const estado of ["confirmado", "em_preparacao", "pronto"]) {
    const r = await rpc(dono.token, "update_order_status", { p_order_id: pedidoId, p_new_status: estado });
    if (r.status >= 400) ko(`transicao para ${estado}`, JSON.stringify(r.corpo).slice(0, 160));
  }
  const est = (await tabela(dono.token, `orders?select=status&id=eq.${pedidoId}`)).corpo?.[0]?.status;
  est === "aguardando_motorista" ? ok("pedido a espera de motorista") : ko("estado inesperado", est);

  const ent = await tabela(dono.token, `deliveries?select=id,status,fleet_id&order_id=eq.${pedidoId}`);
  ent.corpo?.[0]?.id
    ? ok("entrega criada e atribuida a frota", `estado ${ent.corpo[0].status}`)
    : ko("NAO HA ENTREGA para este pedido", "sem entrega nao ha ronda nenhuma para expirar");
  if (!ent.corpo?.[0]?.id) return;

  const ronda1 = await tabela(dono.token, `dispatch_attempts?select=attempt_number,outcome,expires_at&order_id=eq.${pedidoId}&order=attempt_number`);
  const r1 = ronda1.corpo?.[0];
  r1?.outcome === "pendente"
    ? ok("1a ronda aberta", `expira ${new Date(r1.expires_at).toTimeString().slice(0, 8)}`)
    : ko("1a ronda nao ficou pendente", JSON.stringify(ronda1.corpo));
  if (r1?.outcome !== "pendente") return;

  // O motorista NAO aceita. E' esse o cenario.
  console.log(`\n1. Ninguem aceita — a espera da 1a expiracao (${hora()})`);

  const esperarPor = async (titulo, limiteMs) => {
    const ate = Date.now() + limiteMs;
    while (Date.now() < ate) {
      await dormir(30_000);
      const n = await avisos(dono, "dispatch_expirado");
      const achou = n.find((x) => (x.title ?? "").startsWith(titulo));
      if (achou) return achou;
      const restam = Math.round((ate - Date.now()) / 60000);
      console.log(`     ${hora()} ainda nada (restam ~${restam} min)`);
    }
    return null;
  };

  const meio = await esperarPor("Ainda sem motorista", 14 * 60_000);
  meio
    ? ok("o restaurante foi avisado na ronda do meio", `${hora()} — "${meio.title}"`)
    : ko("RONDA DO MEIO EM SILENCIO", "passaram 14 min sem aviso");
  if (meio) {
    /oferecida outra vez/.test(meio.body ?? "")
      ? ok("o aviso diz que foi reoferecida", "e a quantos motoristas")
      : ko("corpo do aviso inesperado", JSON.stringify(meio.body ?? "").slice(0, 160));
  }

  const rondas2 = await tabela(dono.token, `dispatch_attempts?select=attempt_number,outcome&order_id=eq.${pedidoId}&order=attempt_number`);
  (rondas2.corpo ?? []).length === 2 && rondas2.corpo[0].outcome === "expirada" && rondas2.corpo[1].outcome === "pendente"
    ? ok("1a ronda expirada, 2a aberta", JSON.stringify(rondas2.corpo.map((x) => `${x.attempt_number}:${x.outcome}`)))
    : ko("rondas em estado inesperado", JSON.stringify(rondas2.corpo));

  console.log(`\n2. Segunda ronda tambem passa em branco (${hora()})`);
  const fim = await esperarPor("Pedido sem motorista", 14 * 60_000);
  fim
    ? ok("o restaurante foi avisado do esgotamento", `${hora()} — "${fim.title}"`)
    : ko("ESGOTAMENTO EM SILENCIO", "passaram 14 min sem aviso");

  const rondas3 = await tabela(dono.token, `dispatch_attempts?select=attempt_number,outcome&order_id=eq.${pedidoId}&order=attempt_number`);
  (rondas3.corpo ?? []).every((x) => x.outcome === "expirada")
    ? ok("as duas rondas ficaram registadas como expiradas", `${rondas3.corpo.length} rondas`)
    : ko("rondas em estado inesperado no fim", JSON.stringify(rondas3.corpo));

  const hist = await tabela(dono.token, `order_status_history?select=note&order_id=eq.${pedidoId}&order=created_at`);
  const notas = (hist.corpo ?? []).map((h) => h.note ?? "").join(" | ");
  /Ronda 1 expirou/.test(notas)
    ? ok("a ronda do meio ficou no historico do pedido (§74)")
    : ko("historico sem a ronda do meio", notas.slice(0, 200));
  /Dispatch esgotado/.test(notas)
    ? ok("o esgotamento ficou no historico do pedido")
    : ko("historico sem o esgotamento", notas.slice(0, 200));

  // §72: a entrega continua aceitavel por um motorista que apareca tarde.
  const entrega = await tabela(dono.token, `deliveries?select=status,driver_id&order_id=eq.${pedidoId}`);
  console.log(`\n3. Depois de esgotar (${hora()})`);
  const disponiveis = await rpc(motorista.token, "get_available_deliveries");
  (disponiveis.corpo ?? []).some((d) => d.order_id === pedidoId)
    ? ok("a entrega continua oferecida a quem aparecer tarde (§72)")
    : ko("a entrega desapareceu da lista do motorista", JSON.stringify(disponiveis.corpo ?? []).slice(0, 160));

  // O reencaminhamento manual, que e' o que o aviso promete ao restaurante.
  const reof = await rpc(dono.token, "reoffer_delivery", { p_order_id: pedidoId });
  reof.status < 300
    ? ok("o restaurante consegue mesmo reoferecer, como o aviso diz", JSON.stringify(reof.corpo))
    : ko("reoffer_delivery falhou — o aviso promete o que nao funciona", JSON.stringify(reof.corpo).slice(0, 160));

  console.log(`\n  SQL de limpeza (privilegio de admin):`);
  console.log(`    DELETE FROM auth.users WHERE email LIKE 'rlstest-%@deliveryapp.test';`);
  console.log(`    DELETE FROM public.fleet_zone_prices WHERE bairro = '${BAIRRO}';\n`);
}

main()
  .catch((err) => ko("ERRO", err.message))
  .finally(() => {
    console.log(`\n${passou} passou, ${falhou} falhou  (fim ${hora()})\n`);
    process.exit(falhou > 0 ? 1 : 0);
  });
