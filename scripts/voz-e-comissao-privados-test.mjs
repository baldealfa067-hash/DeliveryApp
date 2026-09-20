#!/usr/bin/env node
/**
 * Notas de voz e comprovativos de comissao privados (2026-09-17) — autorizacao
 * por HTTP real, com JWT de utilizador normal. Nunca service_role.
 *
 * Voz (bucket notas-voz). Ouvem: cliente do pedido, dono do restaurante, motorista
 * ATRIBUIDO, admin. Nao ouvem: outro cliente, outro restaurante, motorista da mesma
 * frota sem a entrega, motorista antes de aceitar, dono da frota, anonimo.
 * Pedido de restaurante E envio (voz de recolha + voz de entrega).
 *
 * Comissao (bucket comprovativos-comissao). Veem: restaurante que enviou, admin.
 *
 * Apagar/substituir ligado: recusado. Solto: so o proprio.
 * E o buraco que o desenho abria: pedido com a voz de OUTRO cliente -> recusado.
 *
 * Medicoes de existencia pela LISTAGEM (o download serve cache depois de apagar).
 *
 * TRES FASES (admin como fixture; ficheiros ligados so se limpam sem o pedido):
 *   node scripts/voz-e-comissao-privados-test.mjs --fase=1
 *   (INSERT INTO user_roles ... 'admin')
 *   node scripts/voz-e-comissao-privados-test.mjs --fase=2
 *   (limpeza SQL: pedidos e pagamentos)   ... --fase=3
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
const ESTADO = process.env.ESTADO ?? "/tmp/voz-comissao-estado.json";
const VOZ = "notas-voz", COM = "comprovativos-comissao";
const PRECO = 2500, TAXA = 1000;
let passou = 0, falhou = 0;
const ok = (n, d = "") => { passou++; console.log(`  \x1b[32m✓\x1b[0m ${n}${d ? ` — ${d}` : ""}`); };
const ko = (n, d = "") => { falhou++; console.log(`  \x1b[31m✗\x1b[0m ${n}${d ? ` — ${d}` : ""}`); };
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
const AUDIO = Buffer.from("OggS-voz-de-teste-que-nao-e-um-webm-mas-chega-para-o-storage");
const hdr = (tok) => ({ apikey: ANON, Authorization: `Bearer ${tok ?? ANON}` });
const enviar = (tok, bucket, nome, corpo, tipo, upsert = false) => fetch(`${URL_BASE}/storage/v1/object/${bucket}/${nome}`, {
  method: "POST", headers: { ...hdr(tok), "Content-Type": tipo, ...(upsert ? { "x-upsert": "true" } : {}) }, body: corpo });
const assinar = async (tok, bucket, nome) => {
  const r = await fetch(`${URL_BASE}/storage/v1/object/sign/${bucket}/${nome}`, { method: "POST",
    headers: { ...hdr(tok), "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 60 }) });
  let c = null; try { c = await r.json(); } catch { /* */ }
  return { status: r.status, url: c?.signedURL ? `${URL_BASE}/storage/v1${c.signedURL}` : null };
};
const descarregar = async (tok, bucket, nome) =>
  (await fetch(`${URL_BASE}/storage/v1/object/authenticated/${bucket}/${nome}`, { headers: hdr(tok) })).status;
const listar = async (tok, bucket, prefixo) => {
  const r = await fetch(`${URL_BASE}/storage/v1/object/list/${bucket}`, { method: "POST",
    headers: { ...hdr(tok), "Content-Type": "application/json" }, body: JSON.stringify({ prefix: prefixo, limit: 100 }) });
  let c = []; try { c = await r.json(); } catch { /* */ }
  return Array.isArray(c) ? c : [];
};
const existe = async (tok, bucket, nome) => {
  const partes = nome.split("/");
  return (await listar(tok, bucket, partes.slice(0, -1).join("/"))).some((o) => o.name === partes.at(-1));
};
const apagar = (tok, bucket, nome) => fetch(`${URL_BASE}/storage/v1/object/${bucket}`, { method: "DELETE",
  headers: { ...hdr(tok), "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [nome] }) });

/** Ve = URL assinado E download autenticado funcionam. Nao ve = os dois falham. */
async function acesso(nome, tok, bucket, ficheiro, deve) {
  const s = await assinar(tok, bucket, ficheiro);
  const d = await descarregar(tok, bucket, ficheiro);
  const pode = s.status === 200 && !!s.url && d === 200;
  const naoPode = s.status >= 400 && d >= 400;
  if (deve) pode ? ok(`${nome}: VE`) : ko(`${nome} devia ver`, `sign ${s.status}, download ${d}`);
  else naoPode ? ok(`${nome}: NAO ve`, `sign ${s.status}, download ${d}`) : ko(`FUGA: ${nome} abriu`, `sign ${s.status}, download ${d}`);
}

async function fase1() {
  const MARCA = `rlstest-${Date.now()}`;
  const BAIRRO = `ZonaVoz${MARCA.slice(-6)}`;
  console.log(`\nVoz e comissao privados — fase 1 (${MARCA})\n`);
  const conta = async (etq) => {
    const r = await fetch(`${URL_BASE}/auth/v1/signup`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ email: `${MARCA}-${etq}@deliveryapp.test`, password: "TesteProva#2026", data: { name: etq } }) });
    const c = await r.json();
    if (!c.access_token) throw new Error(`signup ${etq}: ${JSON.stringify(c).slice(0, 200)}`);
    return { token: c.access_token, user_id: c.user.id };
  };
  const cliente = await conta("cliente"), outroCliente = await conta("outrocliente");
  const dono = await conta("dono"), outroDono = await conta("outrodono");
  const frota = await conta("frota"), motorista = await conta("motorista"), motoristaEnvio = await conta("motoristaenvio");
  const outroMotorista = await conta("outromotorista"), admin = await conta("admin");

  const loja = async (c, nome) => {
    await rpc(c.token, "register_as_business");
    const id = (await tabela(c.token, `profiles?select=id&user_id=eq.${c.user_id}`)).corpo?.[0]?.id;
    await tabela(c.token, `profiles?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ name: `${nome} ${MARCA}`, consumption_options: ["entrega"] }) });
    const item = (await tabela(c.token, "menu_items", { method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ business_id: id, name: `Prato ${MARCA}`, price: PRECO }) })).corpo?.[0]?.id;
    return { id, item };
  };
  const L = await loja(dono, "Loja"), L2 = await loja(outroDono, "Outra");

  await rpc(frota.token, "create_fleet", { p_name: `Frota ${MARCA}`, p_phone: `9${String(Date.now()).slice(-7)}` });
  await rpc(frota.token, "upsert_zone_price", { p_bairro: BAIRRO, p_preco: TAXA });
  let n = 0;
  for (const [m, nome] of [[motorista, "Motorista A"], [motoristaEnvio, "Motorista Envio"], [outroMotorista, "Motorista Sem Nada"]]) {
    const tel = `9${String(Date.now() + 13 * ++n).slice(-7)}`;
    await tabela(m.token, `profiles?user_id=eq.${m.user_id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ phone: tel }) });
    await rpc(frota.token, "add_driver_to_fleet", { p_phone: tel, p_name: nome });
    await rpc(m.token, "toggle_driver_availability");
  }
  L.item && L2.item ? ok("dois restaurantes, uma frota com tres motoristas") : ko("montagem falhou");

  const t = Date.now();
  const f = {
    vozPedido: `${cliente.user_id}/${t}-pedido.webm`,
    vozRecolha: `${cliente.user_id}/envios/recolha/${t}-recolha.webm`,
    vozEntrega: `${cliente.user_id}/envios/entrega/${t}-entrega.webm`,
    vozSolta: `${cliente.user_id}/${t}-solta.webm`,
    vozDoOutro: `${outroCliente.user_id}/${t}-outro.webm`,
    comissao: `${dono.user_id}/${t}-comissao.png`,
    comissaoSolta: `${dono.user_id}/${t}-comissao-solta.png`,
    comissaoOutro: `${outroDono.user_id}/${t}-comissao-outro.png`,
  };
  const ups = [
    await enviar(cliente.token, VOZ, f.vozPedido, AUDIO, "audio/webm"),
    await enviar(cliente.token, VOZ, f.vozRecolha, AUDIO, "audio/webm"),
    await enviar(cliente.token, VOZ, f.vozEntrega, AUDIO, "audio/mp4"),
    await enviar(cliente.token, VOZ, f.vozSolta, AUDIO, "audio/webm"),
    await enviar(outroCliente.token, VOZ, f.vozDoOutro, AUDIO, "audio/webm"),
    await enviar(dono.token, COM, f.comissao, PNG, "image/png"),
    await enviar(dono.token, COM, f.comissaoSolta, PNG, "image/png"),
    await enviar(outroDono.token, COM, f.comissaoOutro, PNG, "image/png"),
  ];
  ups.every((r) => r.status < 300) ? ok("8 ficheiros enviados, cada um para a pasta do dono") : ko("upload falhou", ups.map((r) => r.status).join("/"));
  const intruso = await enviar(outroCliente.token, VOZ, `${cliente.user_id}/${t}-intruso.webm`, AUDIO, "audio/webm");
  intruso.status >= 400 ? ok("ninguem escreve na pasta de voz de outro cliente", `HTTP ${intruso.status}`) : ko("ESCREVEU NA PASTA DE OUTRO");
  const naoAudio = await enviar(cliente.token, VOZ, `${cliente.user_id}/${t}-x.png`, PNG, "image/png");
  naoAudio.status >= 400 ? ok("o bucket de voz recusa uma imagem", `HTTP ${naoAudio.status}`) : ko("bucket de voz aceitou imagem");

  const pedido = await rpc(cliente.token, "create_order", {
    p_business_id: L.id, p_customer_id: cliente.user_id, p_customer_name: "Cliente", p_customer_phone: "955101010",
    p_items: [{ menu_item_id: L.item, name: `Prato ${MARCA}`, price: PRECO, qty: 1 }], p_total: PRECO,
    p_consumption_option: "entrega", p_bairro: BAIRRO, p_address: "Perto", p_payment_method: "entrega", p_voice_note_url: f.vozPedido });
  typeof pedido.corpo === "string" ? ok("pedido de restaurante criado com a voz privada") : ko("create_order falhou", erro(pedido));
  for (const s of ["confirmado", "em_preparacao", "pronto"])
    await rpc(dono.token, "update_order_status", { p_order_id: pedido.corpo, p_new_status: s });
  const entregaPedido = (await tabela(dono.token, `deliveries?select=id&order_id=eq.${pedido.corpo}`)).corpo?.[0]?.id;
  entregaPedido ? ok("entrega oferecida a frota, ninguem aceitou ainda") : ko("sem entrega criada");

  const envio = await rpc(cliente.token, "create_send_order", {
    p_send_item_type: "documento", p_description: "Envelope", p_pickup_address: "Mercado", p_pickup_bairro: "Bandim",
    p_pickup_voice_note_url: f.vozRecolha, p_address: "Casa azul", p_bairro: BAIRRO, p_customer_name: "Cliente",
    p_customer_phone: "955101010", p_voice_note_url: f.vozEntrega, p_payment_method: "entrega" });
  envio.corpo?.order_id ? ok("envio criado com voz de recolha e de entrega") : ko("create_send_order falhou", erro(envio));

  const pag = await tabela(dono.token, "commission_payments", { method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ business_id: L.id, amount: 500, proof_url: f.comissao }) });
  pag.status < 300 ? ok("restaurante envia pagamento de comissao com comprovativo privado") : ko("pagamento de comissao falhou", erro(pag));

  writeFileSync(ESTADO, JSON.stringify({ MARCA, BAIRRO, cliente, outroCliente, dono, outroDono, frota, motorista, motoristaEnvio,
    outroMotorista, admin, L, L2, f, pedido: pedido.corpo, entregaPedido, envio: envio.corpo, pagamento: pag.corpo?.[0]?.id }, null, 2));
  console.log(`\n  Conceder admin (fixture):\n    INSERT INTO public.user_roles (user_id, role) VALUES ('${admin.user_id}', 'admin');\n`);
}

async function fase2() {
  const e = JSON.parse(readFileSync(ESTADO, "utf8"));
  const { cliente, outroCliente, dono, outroDono, frota, motorista, motoristaEnvio, outroMotorista, admin, L, L2, f } = e;
  console.log(`\nVoz e comissao privados — fase 2 (${e.MARCA})\n`);
  (await rpc(admin.token, "get_all_commissions")).status === 200 ? ok("conta admin confirmada por HTTP") : ko("a conta admin nao tem o papel");

  console.log("\n1. Voz de um pedido de restaurante, ANTES de um motorista aceitar");
  await acesso("motorista da frota (so a oferta)", motorista.token, VOZ, f.vozPedido, false);

  const ac = await rpc(motorista.token, "accept_delivery", { p_delivery_id: e.entregaPedido });
  ac.status < 300 ? ok("motorista A aceita a entrega") : ko("accept_delivery falhou", erro(ac));

  console.log("\n2. Voz do pedido de restaurante, com motorista atribuido");
  for (const [nome, tok, deve] of [
    ["cliente do pedido", cliente.token, true], ["dono do restaurante do pedido", dono.token, true],
    ["motorista ATRIBUIDO", motorista.token, true], ["admin", admin.token, true],
    ["outro cliente", outroCliente.token, false], ["outro restaurante", outroDono.token, false],
    ["motorista da mesma frota SEM a entrega", outroMotorista.token, false], ["dono da frota", frota.token, false],
    ["anonimo", null, false],
  ]) await acesso(nome, tok, VOZ, f.vozPedido, deve);
  const pub = await fetch(`${URL_BASE}/storage/v1/object/public/${VOZ}/${f.vozPedido}`);
  pub.status >= 400 ? ok("URL publica NAO abre", `HTTP ${pub.status}`) : ko("FUGA: voz abre por URL publica");
  const s = await assinar(cliente.token, VOZ, f.vozPedido);
  const viaUrl = s.url ? await fetch(s.url) : null;
  viaUrl?.status === 200 && Buffer.from(await viaUrl.arrayBuffer()).equals(AUDIO) ? ok("o URL assinado toca o audio certo") : ko("URL assinado nao devolve o audio");
  (await listar(outroMotorista.token, VOZ, cliente.user_id)).length === 0 ? ok("listar a pasta do cliente: outro motorista ve ZERO") : ko("FUGA na listagem");

  console.log("\n3. Envio: voz de recolha e voz de entrega");
  const entregaEnvio = e.envio.delivery_id;
  const ae = await rpc(motoristaEnvio.token, "accept_delivery", { p_delivery_id: entregaEnvio });
  ae.status < 300 ? ok("motorista do envio aceita") : ko("accept_delivery do envio falhou", erro(ae));
  for (const ficheiro of [f.vozRecolha, f.vozEntrega]) {
    const qual = ficheiro === f.vozRecolha ? "recolha" : "entrega";
    for (const [nome, tok, deve] of [
      [`cliente (${qual})`, cliente.token, true], [`motorista do envio (${qual})`, motoristaEnvio.token, true],
      [`admin (${qual})`, admin.token, true], [`motorista do OUTRO pedido (${qual})`, motorista.token, false],
      [`restaurante (${qual}): um envio nao tem restaurante`, dono.token, false], [`anonimo (${qual})`, null, false],
    ]) await acesso(nome, tok, VOZ, ficheiro, deve);
  }

  console.log("\n4. Comprovativo de comissao");
  for (const [nome, tok, deve] of [
    ["restaurante que o enviou", dono.token, true], ["admin", admin.token, true],
    ["outro restaurante", outroDono.token, false], ["cliente", cliente.token, false],
    ["dono da frota", frota.token, false], ["anonimo", null, false],
  ]) await acesso(nome, tok, COM, f.comissao, deve);
  const pubC = await fetch(`${URL_BASE}/storage/v1/object/public/${COM}/${f.comissao}`);
  pubC.status >= 400 ? ok("URL publica do comprovativo NAO abre", `HTTP ${pubC.status}`) : ko("FUGA: comprovativo abre por URL publica");

  console.log("\n5. Apagar e substituir");
  await apagar(cliente.token, VOZ, f.vozPedido);
  (await existe(cliente.token, VOZ, f.vozPedido)) ? ok("cliente NAO apaga a voz ligada a um pedido") : ko("VOZ LIGADA APAGADA");
  await apagar(cliente.token, VOZ, f.vozRecolha);
  (await existe(cliente.token, VOZ, f.vozRecolha)) ? ok("cliente NAO apaga a voz de recolha de um envio") : ko("VOZ DE RECOLHA APAGADA");
  const subV = await enviar(cliente.token, VOZ, f.vozPedido, Buffer.from("outra"), "audio/webm", true);
  subV.status >= 400 ? ok("cliente NAO substitui a voz ligada", `HTTP ${subV.status}`) : ko("VOZ LIGADA SUBSTITUIDA");
  await apagar(dono.token, COM, f.comissao);
  (await existe(dono.token, COM, f.comissao)) ? ok("restaurante NAO apaga comprovativo de comissao ja enviado") : ko("COMPROVATIVO DE COMISSAO APAGADO");
  const subC = await enviar(dono.token, COM, f.comissao, Buffer.from("x"), "image/png", true);
  subC.status >= 400 ? ok("restaurante NAO substitui o comprovativo enviado", `HTTP ${subC.status}`) : ko("COMPROVATIVO SUBSTITUIDO");
  const mudar = await tabela(dono.token, `commission_payments?id=eq.${e.pagamento}`, { method: "PATCH", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ proof_url: f.comissaoSolta }) });
  (await tabela(dono.token, `commission_payments?select=proof_url&id=eq.${e.pagamento}`)).corpo?.[0]?.proof_url === f.comissao
    ? ok("o pagamento continua a apontar para o comprovativo original", `PATCH HTTP ${mudar.status}`) : ko("TROCARAM O COMPROVATIVO DO PAGAMENTO");
  await apagar(outroCliente.token, VOZ, f.vozSolta);
  (await existe(cliente.token, VOZ, f.vozSolta)) ? ok("outro cliente NAO apaga voz solta alheia") : ko("OUTRO CLIENTE APAGOU");
  await apagar(cliente.token, VOZ, f.vozSolta);
  !(await existe(cliente.token, VOZ, f.vozSolta)) ? ok("cliente apaga a sua voz AINDA SOLTA", "regravar antes de pedir") : ko("cliente nao apagou voz solta");
  await apagar(dono.token, COM, f.comissaoSolta);
  !(await existe(dono.token, COM, f.comissaoSolta)) ? ok("restaurante apaga comprovativo de comissao AINDA SOLTO") : ko("nao apagou comprovativo solto");

  console.log("\n6. O servidor recusa a voz / comprovativo de outra pessoa");
  const pedir = (voz) => rpc(cliente.token, "create_order", {
    p_business_id: L.id, p_customer_id: cliente.user_id, p_customer_name: "Cliente", p_customer_phone: "955101010",
    p_items: [{ menu_item_id: L.item, name: `Prato ${e.MARCA}`, price: PRECO, qty: 1 }], p_total: PRECO,
    p_consumption_option: "entrega", p_bairro: e.BAIRRO, p_address: "Perto", p_payment_method: "entrega", p_voice_note_url: voz });
  for (const [nome, voz] of [
    ["voz de OUTRO cliente num pedido", f.vozDoOutro],
    ["voz que nao existe", `${cliente.user_id}/inventada.webm`],
    ["URL de fora", "https://exemplo.test/voz.webm"],
    ["URL publica antiga de ficheiro de OUTRO utilizador", `${URL_BASE}/storage/v1/object/public/portfolio/${outroCliente.user_id}/orders/voice/x.webm`],
  ]) {
    const r = await pedir(voz);
    r.status >= 400 && /indicacao de voz/.test(erro(r)) ? ok(`${nome}: recusado`) : ko(`${nome}: NAO recusado`, `HTTP ${r.status} ${erro(r)}`);
  }
  const envioAlheio = await rpc(cliente.token, "create_send_order", {
    p_send_item_type: "documento", p_description: "x", p_pickup_address: "Outro sitio", p_pickup_voice_note_url: f.vozDoOutro,
    p_address: "Outra casa", p_bairro: e.BAIRRO, p_customer_name: "C", p_customer_phone: "955101010", p_payment_method: "entrega" });
  envioAlheio.status >= 400 && /indicacao de voz/.test(erro(envioAlheio)) ? ok("envio com a voz de recolha de OUTRO cliente: recusado") : ko("envio aceitou voz alheia", erro(envioAlheio));
  const n = ((await rpc(cliente.token, "get_customer_orders", { p_customer_id: cliente.user_id })).corpo ?? []).length;
  n === 2 ? ok("as recusas nao criaram pedidos", "continuam 2") : ko("pedidos a mais", `${n}`);

  const pagar = (tok, bizId, prova) => tabela(tok, "commission_payments", { method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ business_id: bizId, amount: 100, proof_url: prova }) });
  const p1 = await pagar(outroDono.token, L2.id, f.comissao);
  p1.status >= 400 ? ok("outro restaurante usa o comprovativo deste: recusado") : ko("aceitou comprovativo de comissao alheio");
  const p2 = await pagar(dono.token, L.id, f.comissao);
  p2.status >= 400 ? ok("o mesmo comprovativo NAO paga duas comissoes") : ko("comprovativo de comissao reutilizado");
  const p3 = await pagar(dono.token, L.id, "https://exemplo.test/pago.png");
  p3.status >= 400 ? ok("comprovativo de comissao que nao e ficheiro privado: recusado") : ko("aceitou URL solta");

  console.log(`\n  Limpeza SQL antes da fase 3: pedidos ${e.pedido}, ${e.envio.order_id} e pagamento ${e.pagamento}.\n`);
}

async function fase3() {
  const e = JSON.parse(readFileSync(ESTADO, "utf8"));
  console.log(`\nVoz e comissao privados — fase 3 (${e.MARCA})\n`);
  const f = e.f;
  for (const [tok, bucket, nome] of [
    [e.cliente.token, VOZ, f.vozPedido], [e.cliente.token, VOZ, f.vozRecolha], [e.cliente.token, VOZ, f.vozEntrega],
    [e.cliente.token, VOZ, f.vozSolta], [e.outroCliente.token, VOZ, f.vozDoOutro],
    [e.dono.token, COM, f.comissao], [e.dono.token, COM, f.comissaoSolta], [e.outroDono.token, COM, f.comissaoOutro],
  ]) await apagar(tok, bucket, nome);
  let ficam = 0;
  for (const [tok, bucket, pasta] of [[e.cliente.token, VOZ, e.cliente.user_id], [e.cliente.token, VOZ, `${e.cliente.user_id}/envios/recolha`],
    [e.cliente.token, VOZ, `${e.cliente.user_id}/envios/entrega`], [e.outroCliente.token, VOZ, e.outroCliente.user_id],
    [e.dono.token, COM, e.dono.user_id], [e.outroDono.token, COM, e.outroDono.user_id]])
    ficam += (await listar(tok, bucket, pasta)).filter((o) => o.id).length;
  ficam === 0 ? ok("ficheiros de teste apagados") : ko("ficaram ficheiros", `${ficam}`);
}

(async () => {
  try {
    if (fase === "1") await fase1(); else if (fase === "3") await fase3(); else { if (!existsSync(ESTADO)) throw new Error("sem estado da fase 1"); await fase2(); }
  } catch (err) { ko("ERRO", err.message); }
  console.log(`\n${passou} passou, ${falhou} falhou\n`); process.exit(falhou > 0 ? 1 : 0);
})();
