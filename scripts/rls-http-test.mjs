#!/usr/bin/env node
/**
 * Teste de RLS e isolamento por HTTP real, com JWT de utilizador normal.
 *
 * Existe por causa da REGRA DE ENGENHARIA do CLAUDE.md: `service_role` ignora
 * RLS por completo, portanto um teste que passa sob ele nao prova nada sobre o
 * que um utilizador real consegue fazer. Este script usa SEMPRE a chave anon --
 * a mesma que o frontend usa -- e o `access_token` devolvido pelo signup.
 *
 * Cobre o que as Fases 4 e 5 acrescentaram:
 *   1. `get_driver_delivery_stats` -- o motorista ve os SEUS ganhos e mais
 *      nenhuns. Inclui o caso negativo que interessa: o motorista B a pedir os
 *      numeros do motorista A, na mesma frota.
 *   2. `reoffer_delivery` -- so o dono do restaurante do pedido, ou o admin.
 *   3. `offer_delivery_to_fleet` e `expire_stale_dispatch` -- internas, tem de
 *      estar fechadas a qualquer utilizador autenticado.
 *   4. Leitura directa das tabelas com o mesmo JWT, e nao so as RPCs: sao
 *      caminhos diferentes e falham de maneiras diferentes. Foi por nao se
 *      medirem os dois que a recursao infinita de `fleets`/`drivers` passou
 *      despercebida na Fase 3.
 *
 * Correr:  node scripts/rls-http-test.mjs
 */

import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Configuracao -- anon key, nunca service_role
// ---------------------------------------------------------------------------
function lerEnv() {
  const env = { ...process.env };
  try {
    for (const linha of readFileSync(".env", "utf8").split("\n")) {
      const m = linha.match(/^([A-Z0-9_]+)=(.*)$/);
      // valores no .env podem vir entre aspas
      if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* .env e opcional */ }
  return env;
}

const env = lerEnv();
const URL_BASE = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!URL_BASE || !ANON) {
  console.error("Falta VITE_SUPABASE_URL ou VITE_SUPABASE_PUBLISHABLE_KEY no .env");
  process.exit(1);
}

// Salvaguarda: se isto for uma chave service_role, o teste nao vale nada.
// Aborta em vez de dar verde falso.
try {
  const payload = JSON.parse(Buffer.from(ANON.split(".")[1], "base64").toString());
  if (payload.role !== "anon") {
    console.error(`ABORTADO: a chave configurada tem role="${payload.role}", nao "anon".`);
    console.error("Um teste de RLS com service_role nao testa RLS nenhum (ver CLAUDE.md).");
    process.exit(1);
  }
} catch {
  console.error("ABORTADO: nao consegui ler o role da chave. Nao arrisco correr o teste.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Utilitarios
// ---------------------------------------------------------------------------
const MARCA = `rlstest-${Date.now()}`;
let passou = 0, falhou = 0;
const contas = [];

function ok(nome, detalhe = "") {
  passou++;
  console.log(`  [32m✓[0m ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
}
function ko(nome, detalhe = "") {
  falhou++;
  console.log(`  [31m✗[0m ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
}

async function signup(etiqueta) {
  const email = `${MARCA}-${etiqueta}@deliveryapp.test`;
  const password = `Teste!${MARCA}`;
  const r = await fetch(`${URL_BASE}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!j.access_token) {
    throw new Error(`signup de ${etiqueta} falhou: ${JSON.stringify(j).slice(0, 300)}`);
  }
  contas.push({ etiqueta, email, user_id: j.user?.id });
  return { token: j.access_token, user_id: j.user.id, email };
}

async function rpc(token, nome, args = {}) {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${nome}`, {
    method: "POST",
    headers: {
      apikey: ANON,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const texto = await r.text();
  let corpo;
  try { corpo = texto ? JSON.parse(texto) : null; } catch { corpo = texto; }
  return { status: r.status, corpo };
}

async function tabela(token, caminho) {
  const r = await fetch(`${URL_BASE}/rest/v1/${caminho}`, {
    headers: {
      apikey: ANON,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const texto = await r.text();
  let corpo;
  try { corpo = texto ? JSON.parse(texto) : null; } catch { corpo = texto; }
  return { status: r.status, corpo };
}

const naoExiste = (r) =>
  r.status === 404 || (typeof r.corpo?.message === "string" && /does not exist|Could not find/i.test(r.corpo.message));

// ---------------------------------------------------------------------------
// O teste
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\nTeste de RLS por HTTP — ${URL_BASE}`);
  console.log(`Marca das contas de teste: ${MARCA}\n`);

  // --- montar a frota e dois motoristas, tudo por HTTP -----------------------
  console.log("Preparacao");
  const dono = await signup("dono");
  const mA = await signup("motoristaA");
  const mB = await signup("motoristaB");
  const estranho = await signup("estranho");
  ok("4 contas criadas pela API publica");

  // 8 digitos: add_driver_to_fleet normaliza e exige entre 7 e 9.
  const raiz = String(Date.now()).slice(-6);
  const telA = `95${raiz}`;
  const telB = `96${raiz}`;

  // O motorista precisa de telefone no perfil: e por ai que a frota o encontra.
  for (const [m, tel] of [[mA, telA], [mB, telB]]) {
    const r = await fetch(`${URL_BASE}/rest/v1/profiles?user_id=eq.${m.user_id}`, {
      method: "PATCH",
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${m.token}`,
        "Content-Type": "application/json",
        // return=minimal de proposito: `representation` faz o PostgREST
        // devolver a linha toda, e `authenticated` so tem SELECT nas 22 colunas
        // publicas (20260910035702) -- pedir a representacao dava
        // "permission denied for table profiles" por causa das colunas de KYC.
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ phone: tel }),
    });
    if (!r.ok) throw new Error(`nao consegui por telefone no perfil: ${await r.text()}`);
  }
  ok("telefones gravados nos perfis dos motoristas");

  const frota = await rpc(dono.token, "create_fleet", {
    p_name: `Frota ${MARCA}`, p_phone: "900000000", p_bairro: "Sabi",
  });
  if (frota.status !== 200) throw new Error(`create_fleet: ${JSON.stringify(frota.corpo)}`);
  ok("frota criada", `id ${String(frota.corpo).slice(0, 8)}`);

  const dA = await rpc(dono.token, "add_driver_to_fleet", { p_phone: telA, p_name: "Motorista A" });
  const dB = await rpc(dono.token, "add_driver_to_fleet", { p_phone: telB, p_name: "Motorista B" });
  if (dA.status !== 200 || dB.status !== 200) {
    throw new Error(`add_driver_to_fleet: ${JSON.stringify(dA.corpo)} / ${JSON.stringify(dB.corpo)}`);
  }
  const idA = dA.corpo, idB = dB.corpo;
  ok("dois motoristas associados a frota");

  // --- 1. ganhos: o proprio ve, os outros nao -------------------------------
  console.log("\n1. get_driver_delivery_stats (Fase 4 — ganhos)");

  const proprio = await rpc(mA.token, "get_driver_delivery_stats", { p_driver_id: idA });
  if (naoExiste(proprio)) {
    ko("RPC nao existe na base — migracao por aplicar");
  } else if (proprio.status === 200 && Array.isArray(proprio.corpo)) {
    const linha = proprio.corpo[0] ?? {};
    const temGanhos = ["today_earnings", "week_earnings", "month_earnings"].every((c) => c in linha);
    temGanhos
      ? ok("motorista A ve os proprios numeros, com as colunas de ganhos")
      : ko("faltam colunas de ganhos", JSON.stringify(Object.keys(linha)));
  } else {
    ko("motorista A nao conseguiu ler os proprios numeros", JSON.stringify(proprio.corpo).slice(0, 160));
  }

  const cruzado = await rpc(mB.token, "get_driver_delivery_stats", { p_driver_id: idA });
  cruzado.status === 200 && Array.isArray(cruzado.corpo) && cruzado.corpo.length > 0
    ? ko("ISOLAMENTO QUEBRADO: motorista B leu os ganhos do motorista A")
    : ok("motorista B recusado nos ganhos do motorista A", `HTTP ${cruzado.status}`);

  const deFora = await rpc(estranho.token, "get_driver_delivery_stats", { p_driver_id: idA });
  deFora.status === 200 && Array.isArray(deFora.corpo) && deFora.corpo.length > 0
    ? ko("ISOLAMENTO QUEBRADO: conta sem relacao leu os ganhos do motorista A")
    : ok("conta sem relacao recusada", `HTTP ${deFora.status}`);

  const semSessao = await rpc(null, "get_driver_delivery_stats", { p_driver_id: idA });
  semSessao.status === 200 && Array.isArray(semSessao.corpo) && semSessao.corpo.length > 0
    ? ko("ISOLAMENTO QUEBRADO: anonimo leu os ganhos")
    : ok("anonimo recusado", `HTTP ${semSessao.status}`);

  // --- 2. tabela directa, nao so a RPC --------------------------------------
  // Uma RPC SECURITY DEFINER salta o RLS da tabela. Verde na RPC nao diz nada
  // sobre a tabela, e vice-versa -- por isso medem-se os dois.
  console.log("\n2. Leitura directa das tabelas (o outro caminho)");

  const driversB = await tabela(mB.token, `drivers?id=eq.${idA}&select=id,name,fleet_id`);
  Array.isArray(driversB.corpo) && driversB.corpo.length === 0
    ? ok("motorista B le 0 linhas de `drivers` do motorista A")
    : ko("motorista B viu a linha do motorista A", JSON.stringify(driversB.corpo).slice(0, 160));

  const fleetsDono = await tabela(dono.token, "fleets?select=id,name");
  fleetsDono.status === 200
    ? ok("dono le `fleets` sem erro (sem a recursao 42P17 da Fase 3)")
    : ko("leitura directa de `fleets` falhou", `HTTP ${fleetsDono.status} ${JSON.stringify(fleetsDono.corpo).slice(0, 160)}`);

  const daEstranho = await tabela(estranho.token, "dispatch_attempts?select=id");
  if (daEstranho.status === 404 || /does not exist|Could not find/i.test(JSON.stringify(daEstranho.corpo))) {
    ko("`dispatch_attempts` nao existe — migracao por aplicar");
  } else {
    Array.isArray(daEstranho.corpo) && daEstranho.corpo.length === 0
      ? ok("conta sem relacao le 0 linhas de `dispatch_attempts`")
      : ko("conta sem relacao viu tentativas de dispatch", JSON.stringify(daEstranho.corpo).slice(0, 160));
  }

  // --- 3. as internas tem de estar fechadas ---------------------------------
  console.log("\n3. Funcoes internas fechadas a utilizadores (Fase 5)");

  for (const [nome, args] of [
    ["offer_delivery_to_fleet", { p_delivery_id: "00000000-0000-0000-0000-000000000000", p_attempt: 1 }],
    ["expire_stale_dispatch", {}],
  ]) {
    const r = await rpc(estranho.token, nome, args);
    if (naoExiste(r)) {
      ko(`${nome} nao existe — migracao por aplicar`);
    } else if (r.status === 403 || r.status === 401 ||
               /permission denied/i.test(JSON.stringify(r.corpo))) {
      ok(`${nome} recusada a utilizador autenticado`, `HTTP ${r.status}`);
    } else {
      ko(`${nome} EXECUTAVEL por um utilizador qualquer`, `HTTP ${r.status} ${JSON.stringify(r.corpo).slice(0, 160)}`);
    }
  }

  // --- 4. reoffer: so restaurante do pedido ou admin -------------------------
  console.log("\n4. reoffer_delivery (Fase 5)");
  const reoffer = await rpc(estranho.token, "reoffer_delivery", {
    p_order_id: "00000000-0000-0000-0000-000000000000",
  });
  if (naoExiste(reoffer)) {
    ko("reoffer_delivery nao existe — migracao por aplicar");
  } else if (/Sem autorizacao|nao tem entrega/i.test(JSON.stringify(reoffer.corpo))) {
    // Qualquer uma das duas mensagens serve: nenhuma expoe dados, e ambas
    // provam que a funcao correu a guarda antes de fazer seja o que for.
    ok("conta sem relacao recusada", JSON.stringify(reoffer.corpo?.message ?? reoffer.corpo).slice(0, 80));
  } else {
    ko("reoffer_delivery nao recusou uma conta sem relacao", JSON.stringify(reoffer.corpo).slice(0, 160));
  }

  // --- limpeza ---------------------------------------------------------------
  console.log("\nLimpeza");
  // Salvaguarda: so se remove o que tem a marca desta corrida. Se por alguma
  // razao o nome nao bater certo, nao se toca em nada.
  const minhaFrota = await tabela(dono.token, `fleets?select=id,name&owner_user_id=eq.${dono.user_id}`);
  const f = Array.isArray(minhaFrota.corpo) ? minhaFrota.corpo[0] : null;
  if (f && typeof f.name === "string" && f.name.includes(MARCA)) {
    await rpc(dono.token, "remove_driver_from_fleet", { p_driver_id: idA });
    await rpc(dono.token, "remove_driver_from_fleet", { p_driver_id: idB });
    ok("motoristas de teste desassociados da frota");
  } else {
    ko("ABORTEI a limpeza: a frota encontrada nao tem a marca desta corrida");
  }
  // O QUE ESTE SCRIPT NAO CONSEGUE LIMPAR, e porque:
  // apagar contas em auth.users e' admin API (service_role), e apagar uma frota
  // nao tem RPC -- `create_fleet` existe, `delete_fleet` nao. Com a chave anon
  // nao ha caminho nenhum, e usar service_role aqui era exactamente o que a
  // regra do CLAUDE.md proibe.
  //
  // Consequencia real, medida: quatro corridas deixaram 16 contas e 3 frotas em
  // producao, que foi preciso apagar por migracao (20260914192238). Por isso o
  // que fica por limpar sai daqui em SQL pronto a correr, em vez de uma lista
  // para alguem traduzir a mao.
  console.log("\n  Por limpar (precisa de privilegio de admin). SQL:");
  console.log(`    DELETE FROM public.drivers d USING auth.users u`);
  console.log(`     WHERE u.id = d.user_id AND u.email LIKE '${MARCA}-%';`);
  console.log(`    DELETE FROM auth.users WHERE email LIKE '${MARCA}-%';`);
  console.log(`    -- a frota sai por CASCADE (fleets.owner_user_id)`);
  console.log(`\n  Para limpar TUDO o que estas corridas ja deixaram:`);
  console.log(`    DELETE FROM public.drivers d USING auth.users u`);
  console.log(`     WHERE u.id = d.user_id AND u.email LIKE 'rlstest-%@deliveryapp.test';`);
  console.log(`    DELETE FROM auth.users WHERE email LIKE 'rlstest-%@deliveryapp.test';`);

  // --- resultado -------------------------------------------------------------
  console.log(`\n${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`\nERRO: ${e.message}\n`);
  process.exit(1);
});
