#!/usr/bin/env node
/**
 * Voz de localizacao do restaurante: autorizacao e isolamento por HTTP real,
 * com JWT de utilizador normal. Nunca service_role, nunca MCP privilegiado.
 *
 * Porque este teste e sobretudo NEGATIVO: a funcionalidade abre uma via nova na
 * policy do bucket `notas-voz` -- "motorista com entrega por concluir ouve a voz
 * do restaurante". Uma via nova numa policy e uma porta nova; o que interessa
 * medir e que ela nao abre mais do que devia.
 *
 * O que prova:
 *   - o dono grava a voz do SEU negocio, e ouve-a
 *   - NAO grava na voz de OUTRO negocio
 *   - NAO aponta a coluna para a nota de voz de OUTRA pessoa (o buraco que o
 *     create_order fechou a 2026-09-17, repetido aqui noutro caminho)
 *   - o anonimo nao grava
 *   - a coluna NAO se le pela tabela, so pela RPC (caminhos diferentes, falham
 *     de maneiras diferentes -- a regra de engenharia do CLAUDE.md)
 *   - o motorista COM a entrega recebe a voz do restaurante certo e assina-a
 *   - o motorista NAO assina a voz de OUTRO restaurante, com CONTROLO de que
 *     essa voz existe e e assinavel pelo dono dela (senao o 400 nao prova nada)
 *   - o cliente do pedido NAO assina a voz do restaurante (nao e para ele)
 *   - o anonimo nao assina
 *   - regravar SUBSTITUI: a coluna muda e o ficheiro velho desaparece
 *   - DEPOIS de concluida a entrega o motorista perde a voz e perde a assinatura
 *
 * Limpeza impressa no fim, com salvaguardas que abortam se tocarem em dados
 * reais. ATENCAO: o teste leva um pedido ate `concluido`, e isso escreve no
 * ledger real.
 *
 *   node scripts/voz-restaurante-test.mjs
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

const MARCA = `voztest-${Date.now()}`;
const BAIRRO = `ZonaVoz${MARCA.slice(-6)}`;
const PRECO = 3000, TAXA = 1000;
const BUCKET = "notas-voz";

let passou = 0, falhou = 0;
const ok = (n, d = "") => { passou++; console.log(`  \x1b[32m✓\x1b[0m ${n}${d ? ` — ${d}` : ""}`); };
const ko = (n, d = "") => { falhou++; console.log(`  \x1b[31m✗\x1b[0m ${n}${d ? ` — ${d}` : ""}`); };

const cab = (tok) => ({ apikey: ANON, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) });

const rpc = async (tok, nome, args = {}) => {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${nome}`, { method: "POST",
    headers: { ...cab(tok), "Content-Type": "application/json" }, body: JSON.stringify(args) });
  let corpo = null; try { corpo = await r.json(); } catch { /* 204 */ }
  return { status: r.status, corpo };
};
const tabela = async (tok, caminho, init = {}) => {
  const r = await fetch(`${URL_BASE}/rest/v1/${caminho}`, { ...init,
    headers: { ...cab(tok), "Content-Type": "application/json", ...(init.headers ?? {}) } });
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

/** Envia um "audio" para a pasta do proprio utilizador. O conteudo nao importa:
 *  o que se mede e quem o consegue abrir, nao o que se ouve. */
const enviarVoz = async (u, sufixo) => {
  const nome = `${u.user_id}/negocio/localizacao/${Date.now()}-${sufixo}.webm`;
  const r = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${nome}`, { method: "POST",
    headers: { ...cab(u.token), "Content-Type": "audio/webm" }, body: Buffer.from(`voz-${sufixo}`) });
  if (!r.ok) throw new Error(`upload ${sufixo}: HTTP ${r.status} ${(await r.text()).slice(0, 150)}`);
  return nome;
};

/** Assinar e o gesto REAL do frontend (createSignedUrl). E aqui que a policy
 *  de SELECT do bucket decide -- nao no download. */
const assinar = async (tok, nome) => {
  const r = await fetch(`${URL_BASE}/storage/v1/object/sign/${BUCKET}/${nome}`, { method: "POST",
    headers: { ...cab(tok), "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 60 }) });
  return { status: r.status, corpo: await r.text() };
};

/** Existencia pela LISTAGEM, nunca por download: o Storage serve cache de um
 *  ficheiro ja apagado durante algum tempo (armadilha de 2026-09-17). */
const existe = async (tok, nome) => {
  const barra = nome.lastIndexOf("/");
  const r = await fetch(`${URL_BASE}/storage/v1/object/list/${BUCKET}`, { method: "POST",
    headers: { ...cab(tok), "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: nome.slice(0, barra + 1), limit: 100, search: "" }) });
  if (!r.ok) return false;
  return (await r.json()).some((e) => e.name === nome.slice(barra + 1));
};

async function main() {
  console.log(`\nVoz de localizacao do restaurante (${MARCA})\n`);
  console.log("Preparacao");

  const cliente = await conta("cliente");
  const donoA = await conta("donoa");
  const donoB = await conta("donob");
  const frota = await conta("frota");
  const motorista = await conta("motorista");

  const montarRestaurante = async (dono, etq) => {
    await rpc(dono.token, "register_as_business");
    const id = (await tabela(dono.token, `profiles?select=id&user_id=eq.${dono.user_id}`)).corpo?.[0]?.id;
    await tabela(dono.token, `profiles?user_id=eq.${dono.user_id}`, { method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ name: `Restaurante ${etq} ${MARCA}`, lat: 11.8636, lng: -15.5977 }) });
    return id;
  };
  const bizA = await montarRestaurante(donoA, "A");
  const bizB = await montarRestaurante(donoB, "B");

  const NOME = `Prato ${MARCA}`;
  const itemId = (await tabela(donoA.token, "menu_items", { method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ business_id: bizA, name: NOME, price: PRECO }) })).corpo?.[0]?.id;

  await rpc(frota.token, "create_fleet", { p_name: `Frota ${MARCA}`, p_phone: `9${String(Date.now()).slice(-7)}` });
  await rpc(frota.token, "upsert_zone_price", { p_bairro: BAIRRO, p_preco: TAXA });
  const telMot = `9${String(Date.now() + 9).slice(-7)}`;
  await tabela(motorista.token, `profiles?user_id=eq.${motorista.user_id}`, { method: "PATCH",
    headers: { Prefer: "return=minimal" }, body: JSON.stringify({ phone: telMot }) });
  await rpc(frota.token, "add_driver_to_fleet", { p_phone: telMot, p_name: `Motorista ${MARCA}` });
  await rpc(motorista.token, "toggle_driver_availability");
  const driverId = (await tabela(motorista.token, `drivers?select=id&user_id=eq.${motorista.user_id}`)).corpo?.[0]?.id;
  if (!bizA || !bizB || !itemId || !driverId) {
    throw new Error(`preparacao incompleta: A=${bizA} B=${bizB} item=${itemId} motorista=${driverId}`);
  }
  console.log(`  restaurante A ${String(bizA).slice(0, 8)}, B ${String(bizB).slice(0, 8)}, motorista ${String(driverId).slice(0, 8)}`);

  const vozA = await enviarVoz(donoA, "a");
  const vozB = await enviarVoz(donoB, "b");
  const vozCliente = await enviarVoz(cliente, "cli");

  // ------------------------------------------------------------- gravar ---
  console.log("\nGravar a indicacao");
  {
    const r = await rpc(donoA.token, "set_business_location_voice", { p_business_id: bizA, p_ref: vozA });
    r.status < 400 ? ok("o dono grava a voz do seu negocio")
                   : ko("o dono NAO conseguiu gravar", `HTTP ${r.status} ${erro(r)}`);
  }
  await rpc(donoB.token, "set_business_location_voice", { p_business_id: bizB, p_ref: vozB });
  {
    const r = await rpc(donoB.token, "set_business_location_voice", { p_business_id: bizA, p_ref: vozB });
    r.status >= 400 ? ok("dono B NAO grava no negocio de A", erro(r))
                    : ko("FUGA: dono B gravou no negocio de A", `HTTP ${r.status}`);
  }
  {
    // O buraco que interessa: apontar a coluna a voz de OUTRA pessoa daria aos
    // motoristas de A a morada falada de um cliente qualquer.
    const r = await rpc(donoA.token, "set_business_location_voice", { p_business_id: bizA, p_ref: vozCliente });
    r.status >= 400 ? ok("NAO se aponta a coluna para a voz de outra pessoa", erro(r))
                    : ko("FUGA: apontou para a voz de outro utilizador", `HTTP ${r.status}`);
  }
  {
    const r = await rpc(null, "set_business_location_voice", { p_business_id: bizA, p_ref: vozA });
    r.status >= 400 ? ok("anonimo NAO grava", `HTTP ${r.status}`)
                    : ko("FUGA: anonimo gravou", `HTTP ${r.status}`);
  }
  {
    const r = await tabela(donoA.token, `profiles?select=location_voice_url&id=eq.${bizA}`);
    r.status >= 400 ? ok("a coluna NAO se le pela tabela (so pela RPC)", `HTTP ${r.status}`)
                    : ko("FUGA: leu a coluna directamente da tabela", `HTTP ${r.status}`);
  }
  {
    const r = await rpc(donoA.token, "get_my_profile_private");
    (r.corpo ?? [])[0]?.location_voice_url === vozA
      ? ok("o dono le a sua voz por get_my_profile_private")
      : ko("o dono nao leu a sua voz pela RPC", `HTTP ${r.status} ${erro(r)}`);
  }

  // -------------------------------------------------------------- pedido ---
  const criar = await rpc(cliente.token, "create_order", {
    p_business_id: bizA, p_customer_id: cliente.user_id,
    p_customer_name: "Cliente Voz", p_customer_phone: "955123456",
    p_items: [{ menu_item_id: itemId, name: NOME, price: PRECO, qty: 1 }],
    p_total: PRECO, p_consumption_option: "entrega", p_bairro: BAIRRO,
    p_address: "Casa da esquina", p_payment_method: "entrega",
    p_customer_lat: 11.8701, p_customer_lng: -15.6012,
  });
  const pedidoId = typeof criar.corpo === "string" ? criar.corpo : null;
  if (!pedidoId) { console.log(`\nAbortado: create_order ${criar.status} ${erro(criar)}`); process.exit(1); }

  for (const st of ["confirmado", "em_preparacao", "pronto"]) {
    await rpc(donoA.token, "update_order_status", { p_order_id: pedidoId, p_new_status: st });
  }
  const entregaId = (await tabela(donoA.token, `deliveries?select=id&order_id=eq.${pedidoId}`)).corpo?.[0]?.id;
  await rpc(motorista.token, "accept_delivery", { p_delivery_id: entregaId });

  // ------------------------------------------------- motorista com entrega ---
  console.log("\nMotorista COM a entrega por concluir");
  {
    const r = await rpc(motorista.token, "get_my_deliveries");
    const linha = (r.corpo ?? []).find((d) => d.order_id === pedidoId);
    linha?.restaurant_voice_note_url === vozA
      ? ok("recebe a voz do restaurante CERTO")
      : ko("nao recebeu a voz do restaurante", `${JSON.stringify(linha?.restaurant_voice_note_url)}`);
  }
  {
    const r = await assinar(motorista.token, vozA);
    r.status < 400 ? ok("assina a voz do restaurante da sua entrega")
                   : ko("nao assinou a voz do restaurante", `HTTP ${r.status} ${r.corpo.slice(0, 120)}`);
  }
  {
    const r = await assinar(motorista.token, vozB);
    r.status >= 400 ? ok("NAO assina a voz de OUTRO restaurante", `HTTP ${r.status}`)
                    : ko("FUGA: assinou a voz de outro restaurante", `HTTP ${r.status}`);
  }
  {
    // CONTROLO, e nao enfeite: a recusa acima devolve 400, que e tambem o que um
    // ficheiro inexistente devolveria. Sem provar que vozB EXISTE e e assinavel
    // pelo dono dela, aquela assertiva passava na mesma com um caminho errado --
    // verde pela razao errada. Isto separa "a policy recusou" de "nao ha nada la".
    const r = await assinar(donoB.token, vozB);
    r.status < 400 ? ok("controlo: o dono B assina a SUA voz (logo o 400 acima e da policy)")
                   : ko("controlo falhou: nem o dono B assina a sua voz", `HTTP ${r.status} ${r.corpo.slice(0, 120)}`);
  }
  {
    const r = await assinar(cliente.token, vozA);
    r.status >= 400 ? ok("o cliente do pedido NAO assina a voz do restaurante", `HTTP ${r.status}`)
                    : ko("FUGA: o cliente assinou a voz do restaurante", `HTTP ${r.status}`);
  }
  {
    const r = await assinar(null, vozA);
    r.status >= 400 ? ok("anonimo NAO assina", `HTTP ${r.status}`)
                    : ko("FUGA: anonimo assinou", `HTTP ${r.status}`);
  }

  // ------------------------------------------------------------ regravar ---
  console.log("\nRegravar substitui, nao acumula");
  const vozA2 = await enviarVoz(donoA, "a2");
  {
    const r = await rpc(donoA.token, "set_business_location_voice", { p_business_id: bizA, p_ref: vozA2 });
    r.corpo === vozA ? ok("a RPC devolve a referencia ANTERIOR, para se apagar o ficheiro velho")
                     : ko("nao devolveu a anterior", `HTTP ${r.status} ${JSON.stringify(r.corpo).slice(0, 120)}`);
  }
  // O frontend apaga a seguir; aqui faz-se o mesmo gesto, com o token do dono.
  await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${vozA}`, { method: "DELETE", headers: cab(donoA.token) });
  {
    const r = await rpc(donoA.token, "get_my_profile_private");
    (r.corpo ?? [])[0]?.location_voice_url === vozA2
      ? ok("a coluna passou a apontar para a gravacao NOVA")
      : ko("a coluna nao mudou", JSON.stringify((r.corpo ?? [])[0]?.location_voice_url));
  }
  {
    await existe(donoA.token, vozA)
      ? ko("FUGA: a gravacao velha continua no bucket (acumulou)")
      : ok("a gravacao velha saiu do bucket");
  }
  {
    const r = await assinar(motorista.token, vozA2);
    r.status < 400 ? ok("o motorista passa a assinar a gravacao nova")
                   : ko("nao assinou a nova", `HTTP ${r.status}`);
  }

  // ------------------------------------------------- depois de concluida ---
  await rpc(motorista.token, "pickup_delivery", { p_delivery_id: entregaId });
  const codigo = (await tabela(cliente.token, `orders?select=delivery_code&id=eq.${pedidoId}`)).corpo?.[0]?.delivery_code;
  await rpc(motorista.token, "validate_delivery_code", { p_delivery_id: entregaId, p_code: codigo });
  const estado = (await tabela(cliente.token, `orders?select=status&id=eq.${pedidoId}`)).corpo?.[0]?.status;

  console.log(`\nDepois de concluida (pedido em "${estado}")`);
  if (estado !== "concluido") {
    ko("o pedido nao chegou a concluido; as duas assertivas seguintes nao medem nada");
  } else {
    {
      const r = await rpc(motorista.token, "get_my_deliveries");
      const linha = (r.corpo ?? []).find((d) => d.order_id === pedidoId);
      linha && linha.restaurant_voice_note_url == null
        ? ok("a RPC deixa de devolver a voz do restaurante")
        : ko("FUGA: continua a devolver a voz depois de concluida", JSON.stringify(linha?.restaurant_voice_note_url));
    }
    {
      const r = await assinar(motorista.token, vozA2);
      r.status >= 400 ? ok("o motorista deixa de assinar a voz do restaurante", `HTTP ${r.status}`)
                      : ko("FUGA: continua a assinar depois de concluida", `HTTP ${r.status}`);
    }
  }

  console.log(`\n${passou} passaram · ${falhou} falharam`);
  console.log(`\n\x1b[33mLIMPEZA (obrigatoria)\x1b[0m — este teste leva um pedido ate \`concluido\`,`);
  console.log(`e isso ESCREVE no ledger real (§56, append-only por trigger).`);
  console.log(`\nFicheiros no bucket (a Storage API, NAO por SQL -- storage.protect_delete):`);
  for (const f of [vozA2, vozB, vozCliente]) console.log(`  ${BUCKET}/${f}`);
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

  SELECT count(*) INTO n FROM public.orders
   WHERE (business_id = ANY(COALESCE(v_profiles,'{}'::uuid[])) OR fleet_id = ANY(COALESCE(v_fleets,'{}'::uuid[])))
     AND NOT (customer_id = ANY(v_users));
  IF n > 0 THEN RAISE EXCEPTION 'ha % pedidos de clientes REAIS -- abortado', n; END IF;
  SELECT count(*) INTO n FROM public.ledger_entries le
   WHERE le.order_id = ANY(COALESCE(v_orders,'{}'::uuid[]))
     AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = le.order_id AND o.customer_id = ANY(v_users));
  IF n > 0 THEN RAISE EXCEPTION 'ha % lancamentos de pedidos REAIS -- abortado', n; END IF;

  DELETE FROM public.order_ratings WHERE order_id = ANY(COALESCE(v_orders,'{}'::uuid[])) OR driver_id = ANY(COALESCE(v_drivers,'{}'::uuid[]));
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
