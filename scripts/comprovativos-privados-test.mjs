#!/usr/bin/env node
/**
 * Comprovativos privados (2026-09-17) — autorizacao por HTTP real, com JWT de
 * utilizador normal. Nunca service_role: o que se mede e' o que cada pessoa
 * consegue fazer ao Storage com a sua propria sessao.
 *
 * Quem abre um comprovativo ligado a um pedido:
 *   cliente que o enviou SIM · restaurante do pedido SIM · admin SIM
 *   outro cliente NAO · outro restaurante NAO · anonimo NAO · URL publica NAO
 * Medido por tres caminhos diferentes, que falham de maneiras diferentes:
 *   pedir URL assinado, descarregar autenticado, e listar a pasta.
 *
 * Apagar/substituir: um comprovativo ligado a um pedido nao se apaga nem se
 * substitui; um ainda solto apaga-se pelo proprio, e nao por outro.
 *
 * TRES FASES. Dar o papel `admin` exige privilegio que a chave anon nao tem; e'
 * montagem de fixture, nao assercao (mesmo raciocinio do ledger-lifecycle-test).
 * E um comprovativo ligado a pedido nao se apaga pela API -- e' a regra a testar --
 * por isso os ficheiros so' se limpam depois de a limpeza SQL tirar o pedido.
 *
 *   node scripts/comprovativos-privados-test.mjs --fase=1
 *   (INSERT INTO user_roles (user_id, role) VALUES ('<admin>', 'admin'))
 *   node scripts/comprovativos-privados-test.mjs --fase=2
 *   (limpeza SQL: pedido)   node scripts/comprovativos-privados-test.mjs --fase=3
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

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

const fase = process.argv.find((a) => a.startsWith("--fase="))?.split("=")[1] ?? "2";
const ESTADO = process.env.ESTADO ?? "/tmp/comprovativos-privados-estado.json";
const BUCKET = "comprovativos";
const PRECO = 2500;
let passou = 0, falhou = 0;
const ok = (n, d = "") => { passou++; console.log(`  \x1b[32m✓\x1b[0m ${n}${d ? ` — ${d}` : ""}`); };
const ko = (n, d = "") => { falhou++; console.log(`  \x1b[31m✗\x1b[0m ${n}${d ? ` — ${d}` : ""}`); };
async function signup(etq) {
  const r = await fetch(`${URL_BASE}/auth/v1/signup`, { method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: `${MARCA}-${etq}@deliveryapp.test`, password: "TesteProva#2026", data: { name: etq } }) });
  const c = await r.json();
  if (!c.access_token) throw new Error(`signup ${etq}: ${JSON.stringify(c).slice(0, 200)}`);
  return { token: c.access_token, user_id: c.user.id };
}
const rpc = async (tok, nome, args = {}) => {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${nome}`, { method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: JSON.stringify(args) });
  let corpo = null; try { corpo = await r.json(); } catch { /* 204 */ }
  return { status: r.status, corpo };
};
const tabela = async (tok, caminho, init = {}) => {
  const r = await fetch(`${URL_BASE}/rest/v1/${caminho}`, { ...init,
    headers: { apikey: ANON, Authorization: `Bearer ${tok}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  let corpo = null; try { corpo = await r.json(); } catch { /* vazio */ }
  return { status: r.status, corpo };
};
const erro = (r) => JSON.stringify(r.corpo?.message ?? r.corpo ?? "").slice(0, 160);

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PNG2 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8Dwn4GBgYGJAQoAAB3+AgHIZgTcAAAAAElFTkSuQmCC", "base64");
const hdr = (tok) => ({ apikey: ANON, Authorization: `Bearer ${tok ?? ANON}` });
const enviar = (tok, nome, corpo = PNG, upsert = false) => fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${nome}`, {
  method: "POST", headers: { ...hdr(tok), "Content-Type": "image/png", ...(upsert ? { "x-upsert": "true" } : {}) }, body: corpo });
const assinar = async (tok, nome) => {
  const r = await fetch(`${URL_BASE}/storage/v1/object/sign/${BUCKET}/${nome}`, { method: "POST",
    headers: { ...hdr(tok), "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 60 }) });
  let c = null; try { c = await r.json(); } catch { /* */ }
  return { status: r.status, url: c?.signedURL ? `${URL_BASE}/storage/v1${c.signedURL}` : null };
};
const descarregar = async (tok, nome) => {
  const r = await fetch(`${URL_BASE}/storage/v1/object/authenticated/${BUCKET}/${nome}`, { headers: hdr(tok) });
  const b = r.status < 300 ? Buffer.from(await r.arrayBuffer()) : null;
  return { status: r.status, bytes: b };
};
const listar = async (tok, prefixo) => {
  const r = await fetch(`${URL_BASE}/storage/v1/object/list/${BUCKET}`, { method: "POST",
    headers: { ...hdr(tok), "Content-Type": "application/json" }, body: JSON.stringify({ prefix: prefixo, limit: 100 }) });
  let c = []; try { c = await r.json(); } catch { /* */ }
  return Array.isArray(c) ? c : [];
};
// Existe? Pela LISTAGEM, que le a base. NAO pelo download: o Storage serve uma
// copia em cache durante algum tempo depois de apagar, e um "continua la" medido
// por download passava mesmo com o ficheiro apagado (aconteceu na 1.a corrida).
const existe = async (tok, nome) => {
  const [pasta, ficheiro] = [nome.split("/")[0], nome.split("/").slice(1).join("/")];
  return (await listar(tok, pasta)).some((o) => o.name === ficheiro);
};
const apagar = (tok, nome) => fetch(`${URL_BASE}/storage/v1/object/${BUCKET}`, { method: "DELETE",
  headers: { ...hdr(tok), "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [nome] }) });

async function fase1() {
  const MARCA = `rlstest-${Date.now()}`;
  console.log(`\nComprovativos privados — fase 1 (${MARCA})\n`);
  const signupM = async (etq) => {
    const r = await fetch(`${URL_BASE}/auth/v1/signup`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ email: `${MARCA}-${etq}@deliveryapp.test`, password: "TesteProva#2026", data: { name: etq } }) });
    const c = await r.json();
    if (!c.access_token) throw new Error(`signup ${etq}: ${JSON.stringify(c).slice(0, 200)}`);
    return { token: c.access_token, user_id: c.user.id };
  };
  const cliente = await signupM("cliente"), outroCliente = await signupM("outrocliente");
  const dono = await signupM("dono"), outroDono = await signupM("outrodono"), admin = await signupM("admin");

  const loja = async (conta, comOM) => {
    await rpc(conta.token, "register_as_business");
    const id = (await tabela(conta.token, `profiles?select=id&user_id=eq.${conta.user_id}`)).corpo?.[0]?.id;
    await tabela(conta.token, `profiles?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ name: `Loja ${MARCA}`, consumption_options: ["entrega"],
        ...(comOM ? { merchant_code: "#144#32*1#", orange_money_method: "codigo" } : {}) }) });
    const item = (await tabela(conta.token, "menu_items", { method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ business_id: id, name: `Prato ${MARCA}`, price: PRECO }) })).corpo?.[0]?.id;
    return { id, item };
  };
  const L = await loja(dono, true);
  await loja(outroDono, true);
  L.item ? ok("restaurante com Orange Money") : ko("montagem do restaurante falhou");

  const ligado = `${cliente.user_id}/${Date.now()}-ligado.png`;
  const solto = `${cliente.user_id}/${Date.now()}-solto.png`;
  const doOutro = `${outroCliente.user_id}/${Date.now()}-outro.png`;
  const u = [await enviar(cliente.token, ligado), await enviar(cliente.token, solto), await enviar(outroCliente.token, doOutro)];
  u.every((r) => r.status < 300) ? ok("cliente e outro cliente enviam para as suas pastas", "3 ficheiros") : ko("upload falhou", u.map((r) => r.status).join("/"));
  const naPastaAlheia = await enviar(outroCliente.token, `${cliente.user_id}/${Date.now()}-intruso.png`);
  naPastaAlheia.status >= 400 ? ok("ninguem escreve na pasta de outro cliente", `HTTP ${naPastaAlheia.status}`) : ko("ESCREVEU NA PASTA DE OUTRO CLIENTE");

  const pedido = await rpc(cliente.token, "create_order", {
    p_business_id: L.id, p_customer_id: cliente.user_id, p_customer_name: "Cliente", p_customer_phone: "955101010",
    p_items: [{ menu_item_id: L.item, name: `Prato ${MARCA}`, price: PRECO, qty: 1 }], p_total: PRECO,
    p_consumption_option: "entrega", p_bairro: "Nenhum", p_address: "Perto", p_payment_method: "online", p_payment_proof_url: ligado });
  typeof pedido.corpo === "string" ? ok("pedido online criado com o comprovativo privado") : ko("create_order falhou", erro(pedido));

  writeFileSync(ESTADO, JSON.stringify({ MARCA, cliente, outroCliente, dono, outroDono, admin, L, ligado, solto, doOutro, pedido: pedido.corpo }, null, 2));
  console.log(`\n  Conceder admin (fixture):\n    INSERT INTO public.user_roles (user_id, role) VALUES ('${admin.user_id}', 'admin');\n`);
}

async function fase2() {
  const e = JSON.parse(readFileSync(ESTADO, "utf8"));
  const { cliente, outroCliente, dono, outroDono, admin, L, ligado, solto, doOutro } = e;
  console.log(`\nComprovativos privados — fase 2 (${e.MARCA})\n`);
  const souAdmin = await rpc(admin.token, "get_all_commissions");
  souAdmin.status === 200 ? ok("conta admin confirmada por HTTP") : ko("a conta admin nao tem o papel -- a fase 2 mede outra coisa", `HTTP ${souAdmin.status}`);

  console.log("\n1. Quem abre o comprovativo ligado ao pedido");
  const quem = [
    ["cliente que o enviou", cliente.token, true],
    ["dono do restaurante do pedido", dono.token, true],
    ["admin", admin.token, true],
    ["outro cliente", outroCliente.token, false],
    ["outro restaurante", outroDono.token, false],
    ["anonimo", null, false],
  ];
  for (const [nome, tok, deve] of quem) {
    const s = await assinar(tok, ligado);
    const d = await descarregar(tok, ligado);
    const pode = s.status === 200 && !!s.url && d.status === 200;
    const naoPode = s.status >= 400 && d.status >= 400;
    if (deve) pode ? ok(`${nome}: VE`, "URL assinado + download autenticado") : ko(`${nome} devia ver`, `sign ${s.status}, download ${d.status}`);
    else naoPode ? ok(`${nome}: NAO ve`, `sign ${s.status}, download ${d.status}`) : ko(`FUGA: ${nome} abriu o comprovativo`, `sign ${s.status}, download ${d.status}`);
  }
  const assinado = await assinar(cliente.token, ligado);
  const viaAssinado = assinado.url ? await fetch(assinado.url) : null;
  viaAssinado?.status === 200 && Buffer.from(await viaAssinado.arrayBuffer()).equals(PNG)
    ? ok("o URL assinado abre a imagem certa", "e expira: pedido com 60s") : ko("URL assinado nao devolve a imagem", `${viaAssinado?.status}`);
  const publico = await fetch(`${URL_BASE}/storage/v1/object/public/${BUCKET}/${ligado}`);
  publico.status >= 400 ? ok("URL publica NAO abre", `HTTP ${publico.status}: bucket privado`) : ko("FUGA: o comprovativo abre por URL publica");
  const lOutro = await listar(outroCliente.token, cliente.user_id);
  const lOutroDono = await listar(outroDono.token, cliente.user_id);
  lOutro.length === 0 && lOutroDono.length === 0 ? ok("listar a pasta do cliente: outro cliente e outro restaurante veem ZERO") : ko("FUGA na listagem", `${lOutro.length}/${lOutroDono.length}`);
  const sDono = await assinar(dono.token, solto);
  sDono.status >= 400 ? ok("o restaurante NAO ve um comprovativo do cliente que nao e do seu pedido") : ko("FUGA: restaurante viu comprovativo solto do cliente");

  console.log("\n2. Apagar e substituir");
  await apagar(cliente.token, ligado);
  (await existe(cliente.token, ligado)) ? ok("cliente NAO apaga comprovativo ligado a pedido", "continua na base") : ko("O COMPROVATIVO LIGADO FOI APAGADO");
  const sub = await enviar(cliente.token, ligado, PNG2, true);
  const depoisUrl = (await assinar(cliente.token, ligado)).url;
  const depois = { bytes: depoisUrl ? Buffer.from(await (await fetch(`${depoisUrl}&t=${Date.now()}`)).arrayBuffer()) : null };
  sub.status >= 400 && (await existe(cliente.token, ligado)) && depois.bytes?.equals(PNG) ? ok("cliente NAO substitui comprovativo ligado (upsert)", `HTTP ${sub.status}, imagem intacta`) : ko("O COMPROVATIVO LIGADO FOI SUBSTITUIDO", `HTTP ${sub.status}`);
  await apagar(dono.token, ligado); await apagar(admin.token, ligado);
  (await existe(cliente.token, ligado)) ? ok("nem o restaurante nem o admin o apagam pela API") : ko("comprovativo ligado apagado por restaurante/admin");
  await apagar(outroCliente.token, solto);
  (await existe(cliente.token, solto)) ? ok("outro cliente NAO apaga um comprovativo solto alheio") : ko("OUTRO CLIENTE APAGOU");
  await apagar(cliente.token, solto);
  !(await existe(cliente.token, solto)) ? ok("cliente apaga o seu comprovativo AINDA SOLTO", "trocar de imagem no checkout") : ko("cliente nao conseguiu apagar comprovativo solto");

  console.log("\n3. create_order com o bucket novo");
  const pedir = (tok, uid, prova) => rpc(tok, "create_order", {
    p_business_id: L.id, p_customer_id: uid, p_customer_name: "Cliente", p_customer_phone: "955101010",
    p_items: [{ menu_item_id: L.item, name: `Prato ${e.MARCA}`, price: PRECO, qty: 1 }], p_total: PRECO,
    p_consumption_option: "entrega", p_bairro: "Nenhum", p_address: "Perto", p_payment_method: "online", p_payment_proof_url: prova });
  const r1 = await pedir(cliente.token, cliente.user_id, ligado);
  r1.status >= 400 && /ja foi usado/.test(erro(r1)) ? ok("o mesmo comprovativo NAO paga um segundo pedido") : ko("comprovativo reutilizado", `HTTP ${r1.status} ${erro(r1)}`);
  const r2 = await pedir(cliente.token, cliente.user_id, doOutro);
  r2.status >= 400 ? ok("comprovativo de outro cliente: recusado") : ko("aceitou comprovativo de outro cliente");
  const r3 = await pedir(cliente.token, cliente.user_id, `${URL_BASE}/storage/v1/object/public/portfolio/${cliente.user_id}/orders/payment/x.png`);
  r3.status >= 400 ? ok("formato antigo (URL publica do portfolio): recusado") : ko("aceitou o formato antigo");
  const r4 = await pedir(cliente.token, cliente.user_id, solto);
  r4.status >= 400 && /nao foi encontrado/.test(erro(r4)) ? ok("comprovativo apagado: recusado", "por nao existir") : ko("aceitou comprovativo que ja nao existe", erro(r4));
  const n = ((await rpc(cliente.token, "get_customer_orders", { p_customer_id: cliente.user_id })).corpo ?? []).length;
  n === 1 ? ok("continua UM pedido so'", "as recusas nao criaram nada") : ko("pedidos a mais", `${n}`);

  console.log(`\n  Limpeza SQL (admin) antes da fase 3: order_status_history, order_items, orders do pedido ${e.pedido}.\n`);
}

async function fase3() {
  const e = JSON.parse(readFileSync(ESTADO, "utf8"));
  console.log(`\nComprovativos privados — fase 3, limpeza de ficheiros (${e.MARCA})\n`);
  await apagar(e.cliente.token, e.ligado);
  await apagar(e.outroCliente.token, e.doOutro);
  const ficam = (await listar(e.cliente.token, e.cliente.user_id)).length + (await listar(e.outroCliente.token, e.outroCliente.user_id)).length;
  ficam === 0 ? ok("ficheiros de teste apagados", "sem pedido ligado, a API ja deixa") : ko("ficaram ficheiros", `${ficam}`);
  console.log(`\n  Limpeza final (admin): DELETE FROM auth.users WHERE email LIKE '${e.MARCA}-%@deliveryapp.test';\n`);
}

(async () => {
  try {
    if (fase === "1") await fase1(); else if (fase === "3") await fase3(); else { if (!existsSync(ESTADO)) throw new Error("sem estado da fase 1"); await fase2(); }
  } catch (err) { ko("ERRO", err.message); }
  console.log(`\n${passou} passou, ${falhou} falhou\n`); process.exit(falhou > 0 ? 1 : 0);
})();
