#!/usr/bin/env node
/**
 * Fase 9.4 — Avaliacoes: autorizacao e isolamento por HTTP real, com JWT de
 * utilizador normal. Nunca service_role, nunca MCP privilegiado.
 *
 * O que prova (os negativos sao o que interessa):
 *   - nao se avalia um pedido ALHEIO
 *   - nao se avalia DUAS VEZES o mesmo pedido/alvo
 *   - nao se avalia um pedido POR CONCLUIR
 *   - nao se avalia com estrelas fora de 1..5
 *   - o anonimo nao avalia
 *   - INSERT DIRECTO na tabela e recusado (a RPC e a unica porta) -- este e o
 *     caminho que uma RPC verde NAO cobre: os dois discordam em silencio
 *   - o motorista sai da ENTREGA, nao de um parametro do cliente
 *   - um envio (sem restaurante) nao tem restaurante para avaliar
 *   - a media so conta o que foi avaliado
 *   - `reviews` deixou de aceitar insercao anonima
 *   - (2026-09-25) a TABELA deixou de ser publica: le-a o autor, o dono do
 *     restaurante avaliado (so as de restaurante) e o admin. O anonimo, outro
 *     cliente, outro restaurante, o motorista e a frota leem ZERO linhas. A
 *     montra publica passa por get_business_reviews, sem nome e sem ids.
 *
 * Limpeza no fim, com salvaguarda que aborta se tocar em dados reais.
 *
 *   node scripts/avaliacoes-test.mjs
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
const URL_BASE = env.VITE_SUPABASE_URL, ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!URL_BASE || !ANON) { console.error("Faltam variaveis do Supabase"); process.exit(1); }

const MARCA = `avaltest-${Date.now()}`;
const BAIRRO = `ZonaAval${MARCA.slice(-6)}`;
const PRECO = 3000, TAXA = 1000;

let passou = 0, falhou = 0;
const ok = (n, d = "") => { passou++; console.log(`  \x1b[32m✓\x1b[0m ${n}${d ? ` — ${d}` : ""}`); };
const ko = (n, d = "") => { falhou++; console.log(`  \x1b[31m✗\x1b[0m ${n}${d ? ` — ${d}` : ""}`); };

const rpc = async (tok, nome, args = {}) => {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${nome}`, { method: "POST",
    headers: { apikey: ANON, ...(tok ? { Authorization: `Bearer ${tok}` } : {}), "Content-Type": "application/json" },
    body: JSON.stringify(args) });
  let corpo = null; try { corpo = await r.json(); } catch { /* 204 */ }
  return { status: r.status, corpo };
};
const tabela = async (tok, caminho, init = {}) => {
  const r = await fetch(`${URL_BASE}/rest/v1/${caminho}`, { ...init,
    headers: { apikey: ANON, ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
               "Content-Type": "application/json", ...(init.headers ?? {}) } });
  let corpo = null; try { corpo = await r.json(); } catch { /* vazio */ }
  return { status: r.status, corpo };
};
const erro = (r) => JSON.stringify(r.corpo?.message ?? r.corpo ?? "").slice(0, 150);

const conta = async (etq) => {
  const r = await fetch(`${URL_BASE}/auth/v1/signup`, { method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: `${MARCA}-${etq}@deliveryapp.test`, password: "TesteProva#2026", data: { name: etq } }) });
  const c = await r.json();
  if (!c.access_token) throw new Error(`signup ${etq}: ${JSON.stringify(c).slice(0, 200)}`);
  return { token: c.access_token, user_id: c.user.id, etq };
};

async function main() {
  console.log(`\nFase 9.4 — Avaliacoes (${MARCA})\n`);
  console.log("Preparacao");

  const cliente = await conta("cliente");
  const outroCliente = await conta("outrocliente");
  const dono = await conta("dono");
  const frota = await conta("frota");
  const motorista = await conta("motorista");
  const outroDono = await conta("outrodono");
  await rpc(outroDono.token, "register_as_business");

  // Restaurante com um prato.
  await rpc(dono.token, "register_as_business");
  const bizId = (await tabela(dono.token, `profiles?select=id&user_id=eq.${dono.user_id}`)).corpo?.[0]?.id;
  await tabela(dono.token, `profiles?user_id=eq.${dono.user_id}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ name: `Restaurante ${MARCA}`, lat: 11.8636, lng: -15.5977 }) });
  const NOME = `Prato ${MARCA}`;
  const itemId = (await tabela(dono.token, "menu_items", { method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ business_id: bizId, name: NOME, price: PRECO }) })).corpo?.[0]?.id;

  // Frota que cobre o bairro, com um motorista ligado a conta do motorista.
  await rpc(frota.token, "create_fleet", { p_name: `Frota ${MARCA}`, p_phone: `9${String(Date.now()).slice(-7)}` });
  await rpc(frota.token, "upsert_zone_price", { p_bairro: BAIRRO, p_preco: TAXA });
  const telMot = `9${String(Date.now() + 9).slice(-7)}`;
  await tabela(motorista.token, `profiles?user_id=eq.${motorista.user_id}`, { method: "PATCH",
    headers: { Prefer: "return=minimal" }, body: JSON.stringify({ phone: telMot }) });
  await rpc(frota.token, "add_driver_to_fleet", { p_phone: telMot, p_name: `Motorista ${MARCA}` });
  await rpc(motorista.token, "toggle_driver_availability");
  const driverId = (await tabela(motorista.token, `drivers?select=id&user_id=eq.${motorista.user_id}`)).corpo?.[0]?.id;
  if (!bizId || !itemId || !driverId) throw new Error(`preparacao incompleta: biz=${bizId} item=${itemId} motorista=${driverId}`);
  console.log(`  restaurante ${String(bizId).slice(0, 8)}, motorista ${String(driverId).slice(0, 8)}`);

  // Um pedido de entrega, levado ate `concluido`.
  const criar = await rpc(cliente.token, "create_order", {
    p_business_id: bizId, p_customer_id: cliente.user_id,
    p_customer_name: "Cliente Aval", p_customer_phone: "955123456",
    p_items: [{ menu_item_id: itemId, name: NOME, price: PRECO, qty: 1 }],
    p_total: PRECO, p_consumption_option: "entrega", p_bairro: BAIRRO,
    p_address: "Casa da esquina", p_payment_method: "entrega",
    p_customer_lat: 11.8701, p_customer_lng: -15.6012,
  });
  const pedidoId = typeof criar.corpo === "string" ? criar.corpo : null;
  if (!pedidoId) { console.log(`\nAbortado: create_order ${criar.status} ${erro(criar)}`); process.exit(1); }

  console.log("\nAvaliar antes de concluir");
  {
    const r = await rpc(cliente.token, "rate_order", { p_order_id: pedidoId, p_target: "restaurante", p_rating: 5 });
    r.status >= 400 ? ok("pedido por concluir NAO se avalia", erro(r))
                    : ko("FUGA: avaliou um pedido por concluir", `HTTP ${r.status}`);
  }

  // Levar o pedido ate ao fim, pelos caminhos reais.
  for (const st of ["confirmado", "em_preparacao", "pronto"]) {
    await rpc(dono.token, "update_order_status", { p_order_id: pedidoId, p_new_status: st });
  }
  const entregaId = (await tabela(dono.token, `deliveries?select=id&order_id=eq.${pedidoId}`)).corpo?.[0]?.id;
  await rpc(motorista.token, "accept_delivery", { p_delivery_id: entregaId });
  await rpc(motorista.token, "pickup_delivery", { p_delivery_id: entregaId });
  // Fase 9.3: concluir exige prova. O caminho realista e o codigo do cliente --
  // a validacao regista a prova E conclui; `complete_delivery` sozinho ja nao.
  const codigo = (await tabela(cliente.token, `orders?select=delivery_code&id=eq.${pedidoId}`)).corpo?.[0]?.delivery_code;
  await rpc(motorista.token, "validate_delivery_code", { p_delivery_id: entregaId, p_code: codigo });

  const estado = (await tabela(cliente.token, `orders?select=status&id=eq.${pedidoId}`)).corpo?.[0]?.status;
  console.log(`\nPedido levado a "${estado}"`);
  if (estado !== "concluido") {
    console.log(`  \x1b[31mAbortado\x1b[0m: o pedido nao chegou a concluido; o resto do teste nao mede nada.`);
    process.exit(1);
  }

  console.log("\nQuem pode avaliar");
  {
    const r = await rpc(outroCliente.token, "rate_order", { p_order_id: pedidoId, p_target: "restaurante", p_rating: 1 });
    r.status >= 400 ? ok("outro cliente NAO avalia o pedido alheio", erro(r))
                    : ko("FUGA: outro cliente avaliou um pedido alheio", `HTTP ${r.status}`);
  }
  {
    const r = await rpc(dono.token, "rate_order", { p_order_id: pedidoId, p_target: "motorista", p_rating: 5 });
    r.status >= 400 ? ok("o restaurante NAO avalia o pedido", erro(r))
                    : ko("FUGA: o restaurante avaliou o pedido", `HTTP ${r.status}`);
  }
  {
    const r = await rpc(null, "rate_order", { p_order_id: pedidoId, p_target: "restaurante", p_rating: 5 });
    r.status >= 400 ? ok("anonimo NAO avalia", `HTTP ${r.status}`)
                    : ko("FUGA: anonimo avaliou", `HTTP ${r.status}`);
  }

  console.log("\nEstrelas fora do intervalo");
  for (const n of [0, 6, -1]) {
    const r = await rpc(cliente.token, "rate_order", { p_order_id: pedidoId, p_target: "restaurante", p_rating: n });
    r.status >= 400 ? ok(`${n} estrelas recusado`) : ko(`FUGA: aceitou ${n} estrelas`, `HTTP ${r.status}`);
  }

  console.log("\nINSERT directo na tabela (a RPC nao prova este caminho)");
  {
    const r = await tabela(cliente.token, "order_ratings", { method: "POST",
      body: JSON.stringify({ order_id: pedidoId, customer_id: cliente.user_id, target: "restaurante",
                             business_id: bizId, rating: 5 }) });
    r.status >= 400 ? ok("INSERT directo recusado", `HTTP ${r.status} ${erro(r)}`)
                    : ko("FUGA: INSERT directo passou", `HTTP ${r.status}`);
  }

  console.log("\nAvaliar a serio");
  let avaliacaoId = null;
  {
    const r = await rpc(cliente.token, "rate_order", { p_order_id: pedidoId, p_target: "restaurante", p_rating: 4, p_comment: `Bom ${MARCA}` });
    avaliacaoId = typeof r.corpo === "string" ? r.corpo : r.corpo?.id ?? r.corpo;
    r.status < 300 ? ok("o cliente avalia o restaurante", `4 estrelas`)
                   : ko("o cliente NAO conseguiu avaliar", `HTTP ${r.status} ${erro(r)}`);
  }
  {
    const r = await rpc(cliente.token, "rate_order", { p_order_id: pedidoId, p_target: "motorista", p_rating: 5 });
    r.status < 300 ? ok("o cliente avalia o motorista", "5 estrelas")
                   : ko("nao avaliou o motorista", `HTTP ${r.status} ${erro(r)}`);
  }
  {
    const r = await rpc(cliente.token, "rate_order", { p_order_id: pedidoId, p_target: "restaurante", p_rating: 1 });
    r.status >= 400 ? ok("NAO avalia o mesmo pedido/alvo duas vezes", erro(r))
                    : ko("FUGA: avaliou duas vezes", `HTTP ${r.status}`);
  }

  console.log("\nO motorista avaliado saiu da entrega, nao do cliente");
  {
    const linha = (await tabela(cliente.token, `order_ratings?select=driver_id,target&order_id=eq.${pedidoId}&target=eq.motorista`)).corpo?.[0];
    linha?.driver_id === driverId
      ? ok("driver_id e o motorista que fez a entrega")
      : ko("driver_id errado", `esperava ${String(driverId).slice(0, 8)}, veio ${String(linha?.driver_id).slice(0, 8)}`);
  }

  console.log("\nMedias");
  {
    const r = await rpc(null, "get_business_rating", { p_business_id: bizId });
    const m = Array.isArray(r.corpo) ? r.corpo[0] : r.corpo;
    Number(m?.media) === 4 && Number(m?.total) === 1
      ? ok("media do restaurante = 4 sobre 1 avaliacao")
      : ko("media do restaurante errada", JSON.stringify(m));
  }
  {
    const r = await rpc(motorista.token, "get_driver_rating", { p_driver_id: driverId });
    const m = Array.isArray(r.corpo) ? r.corpo[0] : r.corpo;
    Number(m?.media) === 5 ? ok("o motorista ve a sua media") : ko("media do motorista errada", JSON.stringify(m));
  }
  {
    const r = await rpc(outroCliente.token, "get_driver_rating", { p_driver_id: driverId });
    r.status >= 400 ? ok("um estranho NAO ve a media do motorista", erro(r))
                    : ko("FUGA: estranho viu a media do motorista", `HTTP ${r.status}`);
  }

  console.log("\nEnvio: sem restaurante para avaliar");
  {
    const env1 = await rpc(cliente.token, "create_send_order", {
      p_send_item_type: "documento", p_description: `Envelope ${MARCA}`, p_pickup_address: "Bandim", p_pickup_bairro: BAIRRO,
      p_pickup_voice_note_url: null, p_address: "Casa azul", p_customer_name: "Cliente Aval",
      p_customer_phone: "955123456", p_voice_note_url: null, p_bairro: BAIRRO,
      p_pickup_lat: 11.86, p_pickup_lng: -15.59, p_customer_lat: 11.95, p_customer_lng: -15.65,
      p_payment_method: "entrega",
    });
    // `create_send_order` devolve um OBJECTO ({order_id, repetido, fleet_name}),
    // nao um uuid. Passar o objecto inteiro fazia o teste passar por erro de
    // sintaxe de uuid em vez de pela regra -- verde a medir coisa nenhuma.
    const c = env1.corpo;
    const envioId = typeof c === "string" ? c : (Array.isArray(c) ? c[0]?.order_id : c?.order_id);
    if (env1.status < 300 && typeof envioId === "string") {
      // O envio tem de chegar a `concluido`, senao quem recusa e a verificacao de
      // estado e a regra do restaurante fica por medir -- verde sobre outra coisa.
      // Lido com o token do CLIENTE: a policy de `deliveries` so mostra ao motorista
      // as que ja sao dele, e um envio nao tem dono de restaurante. Com o token do
      // motorista isto vinha VAZIO, sem erro, e o accept seguia com undefined.
      const entEnvio = (await tabela(cliente.token, `deliveries?select=id&order_id=eq.${envioId}`)).corpo?.[0]?.id;
      await rpc(motorista.token, "accept_delivery", { p_delivery_id: entEnvio });
      await rpc(motorista.token, "pickup_delivery", { p_delivery_id: entEnvio });
      const codEnvio = (await tabela(cliente.token, `orders?select=delivery_code&id=eq.${envioId}`)).corpo?.[0]?.delivery_code;
      await rpc(motorista.token, "validate_delivery_code", { p_delivery_id: entEnvio, p_code: codEnvio });
      const stEnvio = (await tabela(cliente.token, `orders?select=status&id=eq.${envioId}`)).corpo?.[0]?.status;

      if (stEnvio !== "concluido") {
        ko("envio nao chegou a concluido — a regra do restaurante ficou por medir", `esta em "${stEnvio}"`);
      } else {
        const r = await rpc(cliente.token, "rate_order", { p_order_id: envioId, p_target: "restaurante", p_rating: 5 });
        const porRegra = /nao tem restaurante/i.test(erro(r));
        if (r.status >= 400 && porRegra) ok("envio concluido NAO tem restaurante para avaliar", erro(r));
        else if (r.status >= 400) ko("recusou, mas NAO pela regra", erro(r));
        else ko("FUGA: avaliou o restaurante de um envio", `HTTP ${r.status}`);

        // Mas o motorista do envio avalia-se: fez trabalho real.
        const m = await rpc(cliente.token, "rate_order", { p_order_id: envioId, p_target: "motorista", p_rating: 3 });
        m.status < 300 ? ok("o motorista de um envio avalia-se", "3 estrelas")
                       : ko("nao avaliou o motorista do envio", `HTTP ${m.status} ${erro(m)}`);
      }
    } else {
      ko("envio nao criado — o caso do envio ficou por medir", `HTTP ${env1.status} ${erro(env1)}`);
    }
  }

  console.log("\n`reviews` (Bornaal) deixou de aceitar anonimo");
  {
    const r = await tabela(null, "reviews", { method: "POST",
      body: JSON.stringify({ provider_id: bizId, rating: 5, reviewer_name: "Anonimo", user_id: null }) });
    r.status >= 400 ? ok("anonimo NAO insere em reviews", `HTTP ${r.status}`)
                    : ko("FUGA: anonimo inseriu em reviews", `HTTP ${r.status}`);
  }

  console.log("\nQuem le as LINHAS da tabela (leitura directa, onde o RLS se aplica)");
  const linhas = async (tok) => {
    const r = await tabela(tok, `order_ratings?select=id,target,customer_name,driver_id&order_id=eq.${pedidoId}`);
    return { status: r.status, n: Array.isArray(r.corpo) ? r.corpo.length : 0, corpo: r.corpo };
  };
  {
    // Controlo primeiro: sem o autor a ver as duas, os "zero" abaixo podiam ser
    // uma consulta errada e nao a policy -- verde pela razao errada.
    const r = await linhas(cliente.token);
    r.n === 2 ? ok("CONTROLO: o autor le as suas 2 avaliacoes")
              : ko("o autor nao le as suas avaliacoes", `HTTP ${r.status} ${r.n} linhas`);
  }
  {
    const r = await linhas(dono.token);
    r.n === 1 && r.corpo?.[0]?.target === "restaurante"
      ? ok("o dono do restaurante le so a avaliacao do restaurante", "a do motorista nao")
      : ko("dono do restaurante leu o que nao devia (ou nada)", `HTTP ${r.status} ${JSON.stringify(r.corpo).slice(0, 120)}`);
  }
  for (const [quem, tok] of [["anonimo", null], ["outro cliente", outroCliente.token], ["outro restaurante", outroDono.token],
                             ["o motorista avaliado", motorista.token], ["a frota do motorista", frota.token]]) {
    const r = await linhas(tok);
    r.n === 0 ? ok(`${quem} le ZERO linhas`, `HTTP ${r.status}`)
              : ko(`FUGA: ${quem} leu ${r.n} linhas`, JSON.stringify(r.corpo).slice(0, 120));
  }

  console.log("\nMontra publica do restaurante (get_business_reviews)");
  {
    const r = await rpc(null, "get_business_reviews", { p_business_id: bizId });
    const l = Array.isArray(r.corpo) ? r.corpo : [];
    const chaves = l[0] ? Object.keys(l[0]).sort().join(",") : "";
    l.length === 1 && l[0].comment === `Bom ${MARCA}` && l[0].rating === 4
      ? ok("o anonimo ve a avaliacao do restaurante", "4 estrelas e o comentario")
      : ko("montra publica errada", `HTTP ${r.status} ${JSON.stringify(r.corpo).slice(0, 150)}`);
    chaves === "comment,created_at,rating"
      ? ok("a montra devolve SO estrelas, comentario e data", "sem nome, sem ids")
      : ko("FUGA: a montra devolve mais colunas", chaves);
  }

  console.log(`\n${passou} passaram · ${falhou} falharam`);
  console.log(`\n\x1b[33mLIMPEZA (obrigatoria)\x1b[0m — este teste leva pedidos ate \`concluido\`,`);
  console.log(`e isso ESCREVE no ledger real (§56, append-only por trigger). Correr como dono:`);
  console.log(`
DO $$
DECLARE v_users uuid[]; v_profiles uuid[]; v_fleets uuid[]; v_orders uuid[]; v_drivers uuid[]; n int;
BEGIN
  SELECT array_agg(id) INTO v_users FROM auth.users WHERE email LIKE '${MARCA}-%@deliveryapp.test';
  IF v_users IS NULL THEN RAISE NOTICE 'nada a limpar'; RETURN; END IF;
  SELECT array_agg(id) INTO v_profiles FROM public.profiles WHERE user_id = ANY(v_users);
  SELECT array_agg(id) INTO v_fleets   FROM public.fleets   WHERE owner_user_id = ANY(v_users);
  SELECT array_agg(id) INTO v_drivers  FROM public.drivers  WHERE user_id = ANY(v_users);
  SELECT array_agg(id) INTO v_orders   FROM public.orders
   WHERE customer_id = ANY(v_users) OR business_id = ANY(COALESCE(v_profiles,'{}'::uuid[]));

  -- Salvaguardas: qualquer dado REAL na lista aborta tudo.
  SELECT count(*) INTO n FROM public.orders
   WHERE (business_id = ANY(COALESCE(v_profiles,'{}'::uuid[])) OR fleet_id = ANY(COALESCE(v_fleets,'{}'::uuid[])))
     AND NOT (customer_id = ANY(v_users));
  IF n > 0 THEN RAISE EXCEPTION 'ha % pedidos de clientes REAIS -- abortado', n; END IF;
  SELECT count(*) INTO n FROM public.ledger_entries le
   WHERE le.order_id = ANY(COALESCE(v_orders,'{}'::uuid[]))
     AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = le.order_id AND o.customer_id = ANY(v_users));
  IF n > 0 THEN RAISE EXCEPTION 'ha % lancamentos de pedidos REAIS -- abortado', n; END IF;

  DELETE FROM public.order_ratings WHERE order_id = ANY(COALESCE(v_orders,'{}'::uuid[])) OR driver_id = ANY(COALESCE(v_drivers,'{}'::uuid[]));
  -- O ledger e append-only: o trigger sai SO aqui e volta antes do fim da transaccao.
  ALTER TABLE public.ledger_entries DISABLE TRIGGER ledger_entries_sem_delete;
  DELETE FROM public.ledger_entries WHERE order_id = ANY(COALESCE(v_orders,'{}'::uuid[]))
    OR business_id = ANY(COALESCE(v_profiles,'{}'::uuid[])) OR fleet_id = ANY(COALESCE(v_fleets,'{}'::uuid[]));
  ALTER TABLE public.ledger_entries ENABLE TRIGGER ledger_entries_sem_delete;

  DELETE FROM public.cash_settlements    WHERE fleet_id = ANY(COALESCE(v_fleets,'{}'::uuid[])) OR business_id = ANY(COALESCE(v_profiles,'{}'::uuid[]));
  DELETE FROM public.commission_payments WHERE fleet_id = ANY(COALESCE(v_fleets,'{}'::uuid[])) OR business_id = ANY(COALESCE(v_profiles,'{}'::uuid[]));
  DELETE FROM public.delivery_proofs     WHERE order_id = ANY(COALESCE(v_orders,'{}'::uuid[])) OR driver_id = ANY(COALESCE(v_drivers,'{}'::uuid[]));
  DELETE FROM public.dispatch_attempts   WHERE order_id = ANY(COALESCE(v_orders,'{}'::uuid[])) OR driver_id = ANY(COALESCE(v_drivers,'{}'::uuid[])) OR fleet_id = ANY(COALESCE(v_fleets,'{}'::uuid[]));
  DELETE FROM public.deliveries          WHERE order_id = ANY(COALESCE(v_orders,'{}'::uuid[])) OR driver_id = ANY(COALESCE(v_drivers,'{}'::uuid[])) OR fleet_id = ANY(COALESCE(v_fleets,'{}'::uuid[]));
  DELETE FROM public.order_status_history WHERE order_id = ANY(COALESCE(v_orders,'{}'::uuid[]));
  DELETE FROM public.stock_adjustments   WHERE order_id = ANY(COALESCE(v_orders,'{}'::uuid[]));
  DELETE FROM public.order_items         WHERE order_id = ANY(COALESCE(v_orders,'{}'::uuid[]));
  DELETE FROM public.orders              WHERE id = ANY(COALESCE(v_orders,'{}'::uuid[]));
  DELETE FROM public.menu_items          WHERE business_id = ANY(COALESCE(v_profiles,'{}'::uuid[]));
  DELETE FROM public.drivers             WHERE id = ANY(COALESCE(v_drivers,'{}'::uuid[]));
  DELETE FROM public.fleet_zone_prices   WHERE fleet_id = ANY(COALESCE(v_fleets,'{}'::uuid[]));
  DELETE FROM public.fleets              WHERE id = ANY(COALESCE(v_fleets,'{}'::uuid[]));
  DELETE FROM public.notifications       WHERE user_id = ANY(v_users);
  DELETE FROM public.user_roles          WHERE user_id = ANY(v_users);
  DELETE FROM public.profiles            WHERE user_id = ANY(v_users);
  DELETE FROM auth.users                 WHERE id = ANY(v_users);
END $$;`);
  process.exit(falhou ? 1 : 0);
}

main().catch((e) => { console.error(`\nAbortado: ${e.message}`); process.exit(1); });
