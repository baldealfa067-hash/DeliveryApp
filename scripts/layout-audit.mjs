#!/usr/bin/env node
/**
 * Auditoria de layout (2026-09-27): cada ecra x 4 larguras de telemovel
 * (360/375/390/412), com medicao por GEOMETRIA no browser, nao a olho:
 *  - PAGINA-DESLIZA / FORA-DO-ECRA: algo mais largo que o ecra;
 *  - TEXTO-CORTADO: texto fora de um antepassado que recorta (RETICENCIAS e
 *    LINE-CLAMP sao contados a parte: sao cortes intencionais);
 *  - SOBREPOSTO / CONTROLOS-SOBREPOSTOS: texto ou botoes uns por cima dos outros;
 *  - PALAVRA-PARTIDA e PRECO-PARTIDO ("6500" numa linha, "CFA" na outra);
 *  - PLACEHOLDER-CORTADO: medido com canvas, porque nao e texto do DOM;
 *  - ESCONDIDO-PELA-BARRA: o fim da pagina por baixo da barra fixa.
 *
 * Contra PRODUCAO por omissao. Os ficheiros de www.itudoo.com (e as fontes)
 * descem uma vez para memoria e sao servidos ao browser tal e qual: a rede desta
 * maquina ate ao Vercel leva 7-18s por pedido e pendura. O Supabase fica ao vivo.
 *
 * Precisa de scripts/.layout-dados.json (node scripts/layout-dados-teste.mjs).
 *
 *   node scripts/layout-audit.mjs [ecra1,ecra2]         # producao
 *   BASE_URL=http://localhost:5199 node scripts/layout-audit.mjs
 *   LANG_APP=fr WIDTHS=360 CONC=2 SAIDA=/tmp/audit node scripts/layout-audit.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const DIR = process.env.SAIDA || "/tmp/layout-audit";
const BASE = process.env.BASE_URL || "https://www.itudoo.com";
const LANG = process.env.LANG_APP || "pt";
const WIDTHS = (process.env.WIDTHS || "360,375,390,412").split(",").map(Number);
const FILTRO = process.argv[2] || "";
const TAG = process.env.TAG || "prod";
const SHOTS = `${DIR}/shots-${TAG}-${LANG}`;
mkdirSync(SHOTS, { recursive: true });

const env = {};
for (const l of readFileSync(".env", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const URL_BASE = env.VITE_SUPABASE_URL, ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const REF = new URL(URL_BASE).hostname.split(".")[0];
const D = JSON.parse(readFileSync("scripts/.layout-dados.json", "utf8"));

async function login(email) {
  for (let t = 1; ; t++) {
    try { return await login1(email); } catch (e) { if (t >= 4) throw e; }
  }
}
async function login1(email) {
  const r = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, { method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: D.pass }) });
  const s = await r.json();
  if (!s.access_token) throw new Error(`login ${email}: ${JSON.stringify(s).slice(0, 200)}`);
  return s;
}

// ------------------------------------------------------------ medicao ----
function medir() {
  const W = document.documentElement.clientWidth;
  const out = [];
  const nome = (el) => {
    if (!el) return "?";
    const t = (el.innerText || el.value || el.getAttribute?.("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 60);
    const cls = (typeof el.className === "string" ? el.className : "").split(/\s+/).slice(0, 5).join(".");
    return `<${el.tagName.toLowerCase()}${cls ? "." + cls : ""}> "${t}"`;
  };
  const visivel = (el) => {
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
      if (a.getAttribute("aria-hidden") === "true" && a.hasAttribute("data-aria-hidden")) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const fixo = (el) => {
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const p = getComputedStyle(a).position;
      if (p === "fixed" || p === "sticky") return a;
    }
    return null;
  };
  // Onde ha um dialogo aberto, so ele conta (o resto esta por tras).
  const dialogo = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].filter(visivel).pop();
  const raiz = dialogo || document.body;

  const sw = document.documentElement.scrollWidth;
  if (sw > W + 1) out.push({ t: "PAGINA-DESLIZA", d: `scrollWidth ${sw} > ${W}` });

  // 1. Elementos para la do ecra, sem antepassado que os recorte.
  const reportados = new Set();
  for (const el of raiz.querySelectorAll("*")) {
    if (!visivel(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right <= W + 1 && r.left >= -1) continue;
    let clip = null;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX !== "visible") { clip = a; break; }
    }
    if (clip) {
      const cs = getComputedStyle(clip);
      if (cs.overflowX === "auto" || cs.overflowX === "scroll") continue; // faixa deslizante, intencional
      const cr = clip.getBoundingClientRect();
      if (cr.right <= W + 1 && cr.left >= -1) continue; // recortado dentro do ecra: tratado em 2.
    }
    let ja = false;
    for (let a = el.parentElement; a; a = a.parentElement) if (reportados.has(a)) { ja = true; break; }
    if (ja) continue;
    reportados.add(el);
    out.push({ t: "FORA-DO-ECRA", d: `${nome(el)} left=${Math.round(r.left)} right=${Math.round(r.right)} (W=${W})` });
  }

  // 2. Texto cortado: cada linha de texto tem de caber em todos os antepassados que recortam.
  const walker = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
  const linhas = [];
  const palavrasPartidas = [];
  let n;
  while ((n = walker.nextNode())) {
    const txt = n.textContent;
    if (!txt || !txt.trim()) continue;
    const el = n.parentElement;
    if (!el || !visivel(el)) continue;
    if (["SCRIPT", "STYLE", "NOSCRIPT", "OPTION"].includes(el.tagName)) continue;
    if (el.closest(".sr-only")) continue; // texto so para leitores de ecra: recortado de proposito
    const range = document.createRange();
    range.selectNodeContents(n);
    const rects = [...range.getClientRects()].filter((q) => q.width > 1 && q.height > 1);
    const f = fixo(el);
    // O rect de um texto com reticencias mede o texto inteiro; o que se ve e so
    // a parte dentro dos antepassados que recortam.
    const clips = [];
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX !== "visible" || cs.overflowY !== "visible") clips.push(a.getBoundingClientRect());
    }
    for (const q0 of rects) {
      let L = q0.left, R = q0.right, T = q0.top, B = q0.bottom;
      for (const c of clips) { L = Math.max(L, c.left); R = Math.min(R, c.right); T = Math.max(T, c.top); B = Math.min(B, c.bottom); }
      if (R - L > 1 && B - T > 1) linhas.push({ el, q: { left: L, right: R, top: T, bottom: B }, f, n });
    }
    // recorte
    const csEl = getComputedStyle(el);
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
      if (cs.overflowX === "auto" || cs.overflowX === "scroll" || cs.overflowY === "auto" || cs.overflowY === "scroll") break;
      const ar = a.getBoundingClientRect();
      const fora = rects.some((q) => q.right > ar.right + 1.5 || q.left < ar.left - 1.5 || q.bottom > ar.bottom + 1.5 || q.top < ar.top - 1.5);
      if (fora) {
        const eli = a.scrollWidth > a.clientWidth + 1 && getComputedStyle(a).textOverflow === "ellipsis";
        const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== "none";
        out.push({ t: eli ? "RETICENCIAS" : clamp ? "LINE-CLAMP" : "TEXTO-CORTADO", d: `${nome(el)} em ${nome(a)}` });
        break;
      }
    }
    // palavras partidas a meio (sem hifen)
    if (csEl.whiteSpace !== "nowrap" && rects.length > 1) {
      const re = /[^\s\-–—\/]{3,}/g;
      let m;
      while ((m = re.exec(txt))) {
        const r2 = document.createRange();
        r2.setStart(n, m.index); r2.setEnd(n, m.index + m[0].length);
        const tops = [...new Set([...r2.getClientRects()].filter((q) => q.width > 1).map((q) => Math.round(q.top)))];
        if (tops.length > 1) palavrasPartidas.push(`"${m[0]}" em ${nome(el)}`);
      }
    }
  }
  for (const p of palavrasPartidas.slice(0, 8)) out.push({ t: "PALAVRA-PARTIDA", d: p });

  // 2b. Preco partido entre linhas ("6500" numa, "CFA" na outra).
  {
    const w2 = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
    let m2, t2;
    while ((t2 = w2.nextNode())) {
      const el = t2.parentElement;
      if (!el || !visivel(el) || el.closest(".sr-only")) continue;
      const re = /\d[\d\u00a0\u202f .]*\s?F?CFA/g;
      while ((m2 = re.exec(t2.textContent))) {
        const r = document.createRange();
        r.setStart(t2, m2.index); r.setEnd(t2, m2.index + m2[0].length);
        const tops = [...new Set([...r.getClientRects()].filter((q) => q.width > 1).map((q) => Math.round(q.top)))];
        if (tops.length > 1) out.push({ t: "PRECO-PARTIDO", d: `"${m2[0]}" em ${nome(el)}` });
      }
    }
  }

  // 3. Texto por cima de texto (mesma camada: ambos fixos ou ambos no fluxo).
  const vistos = new Set();
  for (let i = 0; i < linhas.length; i++) {
    for (let j = i + 1; j < linhas.length; j++) {
      const A = linhas[i], B = linhas[j];
      if (A.n === B.n) continue;
      if ((A.f === null) !== (B.f === null)) continue;
      const ox = Math.min(A.q.right, B.q.right) - Math.max(A.q.left, B.q.left);
      const oy = Math.min(A.q.bottom, B.q.bottom) - Math.max(A.q.top, B.q.top);
      if (ox > 2 && oy > 3) {
        if (A.el.contains(B.el) || B.el.contains(A.el)) { /* texto dentro de texto: ainda assim sobreposto */ }
        const k = `${nome(A.el)}|${nome(B.el)}`;
        if (vistos.has(k)) continue;
        vistos.add(k);
        out.push({ t: "SOBREPOSTO", d: `${nome(A.el)} x ${nome(B.el)} (${Math.round(ox)}x${Math.round(oy)}px)` });
      }
    }
  }

  // 3b. Placeholders cortados (nao sao texto do DOM: mede-se com a fonte real).
  const cv = document.createElement("canvas").getContext("2d");
  for (const inp of raiz.querySelectorAll("input[placeholder],textarea[placeholder]")) {
    if (!visivel(inp) || inp.value) continue;
    const cs = getComputedStyle(inp);
    cv.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const larg = cv.measureText(inp.placeholder).width;
    const util = inp.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (inp.tagName === "INPUT" && larg > util + 1) out.push({ t: "PLACEHOLDER-CORTADO", d: `"${inp.placeholder}" precisa ${Math.round(larg)}px, tem ${Math.round(util)}px` });
  }

  // 4. Controlos por cima de controlos.
  const ctl = [...raiz.querySelectorAll("button,a[href],input,select,textarea,[role=tab],[role=combobox]")].filter(visivel);
  for (let i = 0; i < ctl.length; i++) for (let j = i + 1; j < ctl.length; j++) {
    const a = ctl[i], b = ctl[j];
    if (a.contains(b) || b.contains(a)) continue;
    if ((fixo(a) === null) !== (fixo(b) === null)) continue;
    const A = a.getBoundingClientRect(), B = b.getBoundingClientRect();
    const ox = Math.min(A.right, B.right) - Math.max(A.left, B.left);
    const oy = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
    if (ox > 4 && oy > 4) out.push({ t: "CONTROLOS-SOBREPOSTOS", d: `${nome(a)} x ${nome(b)} (${Math.round(ox)}x${Math.round(oy)}px)` });
  }
  return out;
}

// No fim da pagina, o ultimo conteudo tem de ficar acima da barra fixa de baixo.
function medirFundo() {
  const out = [];
  const H = window.innerHeight;
  const fixosBaixo = [...document.querySelectorAll("body *")].filter((el) => {
    const cs = getComputedStyle(el);
    if (cs.position !== "fixed" || cs.display === "none" || cs.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.height > 20 && r.height < H / 3 && r.bottom >= H - 2 && r.width > window.innerWidth * 0.6;
  });
  if (!fixosBaixo.length) return out;
  const topoBarra = Math.min(...fixosBaixo.map((e) => e.getBoundingClientRect().top));
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let fundo = 0, quem = null, n;
  while ((n = walker.nextNode())) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el || fixosBaixo.some((f) => f.contains(el))) continue;
    let emFixo = false;
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const p = getComputedStyle(a).position;
      if (p === "fixed" || p === "sticky") { emFixo = true; break; }
      const cs = getComputedStyle(a);
      if (cs.display === "none" || cs.visibility === "hidden") { emFixo = true; break; }
    }
    if (emFixo) continue;
    const r = document.createRange(); r.selectNodeContents(n);
    for (const q of r.getClientRects()) if (q.height > 1 && q.bottom > fundo) { fundo = q.bottom; quem = el; }
  }
  // Conteudo em botoes/controlos no fundo tambem conta
  for (const el of document.querySelectorAll("button,a[href],input")) {
    if (fixosBaixo.some((f) => f.contains(el))) continue;
    let emFixo = false;
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.position === "fixed" || cs.position === "sticky" || cs.display === "none" || cs.visibility === "hidden") { emFixo = true; break; }
    }
    if (emFixo) continue;
    const q = el.getBoundingClientRect();
    if (q.height > 1 && q.bottom > fundo) { fundo = q.bottom; quem = el; }
  }
  if (fundo > topoBarra + 1) {
    out.push({ t: "ESCONDIDO-PELA-BARRA", d: `ultimo conteudo acaba em ${Math.round(fundo)}, barra fixa comeca em ${Math.round(topoBarra)}: "${(quem?.innerText || "").trim().slice(0, 50)}"` });
  }
  return out;
}

// ------------------------------------------------------------- ecras ----
const P = D.pedidos;
const clicarTexto = async (page, re) => {
  const b = page.getByRole("button", { name: re }).first();
  await b.click({ timeout: 5000 });
  await page.waitForTimeout(500);
};
// A barra fixa de baixo tapa o botao no ponto de clique enquanto se rola, e o
// Playwright recusa o clique: aciona-se o botao directamente.
const carregar = async (loc) => { await loc.waitFor({ state: "attached", timeout: 15000 }); await loc.evaluate((el) => el.click()); await loc.page().waitForTimeout(400); };
// O Select do Radix abre com o teclado (ou pointerdown), nao com click().
const escolherPrimeiraOpcao = async (page, combobox) => {
  await combobox.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("option").first().waitFor({ timeout: 5000 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1200);
};
const montarCarrinho = async (page) => {
  for (const nomeItem of [/Caldo de Mancarra/, /Peixe Bica/, /Sumo de Baob/]) {
    await carregar(page.getByRole("button", { name: new RegExp(`Adicionar ${nomeItem.source}`) }).first());
  }
  await carregar(page.getByRole("button", { name: /^Entrega$/ }).first());
  await escolherPrimeiraOpcao(page, page.getByRole("combobox").first());
};
const ECRAS = [
  // anonimo
  { id: "anon-entrada", role: null, path: "/" },
  { id: "anon-login", role: null, path: "/login" },
  { id: "anon-login-cliente", role: null, path: "/login?mode=cliente" },
  { id: "anon-registar", role: null, path: "/login?tab=registar" },
  { id: "anon-esqueci", role: null, path: "/esqueci-senha" },
  { id: "anon-inicio", role: null, path: "/inicio" },
  { id: "anon-sobre", role: null, path: "/sobre" },
  { id: "anon-contacto", role: null, path: "/contacto" },
  { id: "anon-termos", role: null, path: "/termos" },
  { id: "anon-404", role: null, path: "/nao-existe" },
  // cliente
  { id: "cli-inicio", role: "cliente", path: "/inicio" },
  { id: "cli-loja", role: "cliente", path: `/loja/${D.biz}` },
  { id: "cli-checkout", role: "cliente", path: `/loja/${D.biz}`, acao: async (page) => { await montarCarrinho(page); } },
  { id: "cli-checkout-confirmar", role: "cliente", path: `/loja/${D.biz}`, acao: async (page) => {
      await montarCarrinho(page);
      await carregar(page.getByRole("button", { name: /^Fazer Pedido$/ }).first());
      await page.waitForTimeout(1000);
    } },
  { id: "cli-enviar", role: "cliente", path: "/enviar" },
  { id: "cli-pedidos", role: "cliente", path: "/meus-pedidos" },
  { id: "cli-pedido-acaminho", role: "cliente", path: `/pedido/${P.pB}` },
  { id: "cli-pedido-novo", role: "cliente", path: `/pedido/${P.pD}` },
  { id: "cli-pedido-concluido", role: "cliente", path: `/pedido/${P.pA}` },
  { id: "cli-pedido-cancelado", role: "cliente", path: `/pedido/${P.pF}` },
  { id: "cli-perfil", role: "cliente", path: "/perfil" },
  { id: "cli-contacto", role: "cliente", path: "/contacto" },
  { id: "cli-notificacoes", role: "cliente", path: "/notificacoes" },
  // restaurante
  { id: "loja-painel", role: "dono", path: "/painel-loja", tabs: true },
  { id: "loja-manual", role: "dono", path: "/painel-loja", acao: async (page) => {
      await clicarTexto(page, /pedido manual|Lançar pedido|Pedido manual/i);
      await page.waitForTimeout(800);
    } },
  { id: "loja-manual-entrega", role: "dono", path: "/painel-loja", acao: async (page) => {
      await clicarTexto(page, /pedido manual|Lançar pedido|Pedido manual/i);
      await page.waitForTimeout(800);
      const d = page.getByRole("dialog");
      await carregar(d.getByRole("button", { name: /Caldo|\+/ }).first()).catch(() => {});
      await carregar(d.locator("button:has(svg.lucide-plus)").nth(2));
      await carregar(d.getByRole("button", { name: /^Entrega$/ }));
      const cb = d.getByRole("combobox");
      if (await cb.count()) await escolherPrimeiraOpcao(page, cb.first());
    } },
  { id: "loja-editar", role: "dono", path: "/painel-loja/editar" },
  // frota
  { id: "frota-painel", role: "frota", path: "/painel-frota", tabs: true },
  { id: "frota-motorista-detalhe", role: "frota", path: "/painel-frota", acao: async (page) => {
      await page.getByRole("button", { name: /Aliu Mamadu/ }).first().click();
      await page.waitForTimeout(1500);
    } },
  // motorista
  { id: "mot-painel", role: "motorista1", path: "/painel-motorista", tabs: true },
  { id: "mot-perfil", role: "motorista1", path: "/perfil" },
];

async function auditarEstado(page, rotulo, W, res) {
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForTimeout(400);
  await page.evaluate(() => window.scrollTo(0, 0));
  const a = await page.evaluate(medir);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(250);
  const b = await page.evaluate(medirFundo);
  await page.evaluate(() => window.scrollTo(0, 0));
  const probs = [...a, ...b];
  res.push({ ecra: rotulo, w: W, probs });
  const ficheiro = `${SHOTS}/${rotulo.replace(/[^a-z0-9-]+/gi, "_")}-${W}.png`;
  await page.screenshot({ path: ficheiro, fullPage: true });
  const graves = probs.filter((p) => !["RETICENCIAS", "LINE-CLAMP"].includes(p.t));
  console.log(`${graves.length ? "\x1b[31m✗" : "\x1b[32m✓"}\x1b[0m ${rotulo} @${W}  ${graves.length ? graves.length + " problema(s)" : ""}${probs.length - graves.length ? ` (+${probs.length - graves.length} reticencias)` : ""}`);
  for (const p of graves) console.log(`     ${p.t}: ${p.d}`);
}

// Cache dos ficheiros de PRODUCAO (o proprio bundle servido por www.itudoo.com
// e as fontes). A rede desta maquina ate ao Vercel leva 7-18s por pedido e
// pendura; assim cada ficheiro desce uma vez, com tentativas, e o browser
// recebe exactamente os mesmos bytes. O Supabase continua ao vivo.
const HOSTS_CACHE = new Set([new URL(BASE).hostname, "fonts.googleapis.com", "fonts.gstatic.com"]);
const cache = new Map();
async function buscar(url) {
  let ultimo;
  for (let t = 1; t <= 5; t++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(45000), headers: { "user-agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36" } });
      const body = Buffer.from(await r.arrayBuffer());
      return { status: r.status, type: r.headers.get("content-type") || "application/octet-stream", body };
    } catch (e) { ultimo = e; }
  }
  throw ultimo;
}
async function ligarCache(ctx) {
  if (BASE.startsWith("http://localhost")) {
    await ctx.route((u) => u.hostname === "fonts.googleapis.com" || u.hostname === "fonts.gstatic.com", servir);
    return;
  }
  await ctx.route((u) => HOSTS_CACHE.has(u.hostname), servir);
}
async function servir(route) {
  const req = route.request();
  const u = new URL(req.url());
  // Todas as rotas da SPA devolvem o mesmo index.html.
  const key = req.resourceType() === "document" && u.hostname === new URL(BASE).hostname ? "__doc__" : req.url();
  let p = cache.get(key);
  if (!p) { p = buscar(req.url()); cache.set(key, p); }
  try {
    const v = await p;
    await route.fulfill({ status: v.status, headers: { "content-type": v.type, "access-control-allow-origin": "*" }, body: v.body });
  } catch {
    cache.delete(key);
    await route.abort().catch(() => {});
  }
}

const browser = await chromium.launch();
const sessoes = {};
for (const [k, email] of Object.entries(D.contas)) sessoes[k] = await login(email);
const res = [];
const fila = [];
const FILTROS = FILTRO ? FILTRO.split(",") : [];
for (const e of ECRAS) if (!FILTROS.length || FILTROS.some((f) => e.id.includes(f))) for (const W of WIDTHS) fila.push([e, W]);
const CONC = Number(process.env.CONC || 3);
async function worker() {
  while (fila.length) {
    const [e, W] = fila.shift();
    await correr(e, W);
  }
}
async function correr(e, W) {
  {
    const ctx = await browser.newContext({ viewport: { width: W, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, locale: "pt-PT", serviceWorkers: "block" });
    const sess = e.role ? sessoes[e.role] : null;
    await ctx.addInitScript(([k, v, lang]) => {
      try {
        if (v) localStorage.setItem(k, v);
        localStorage.setItem("bornaal_lang", lang);
        localStorage.setItem("bornaal:install-asked", "1");
        localStorage.setItem("bornaal:push-asked", "1");
      } catch { /* */ }
    }, [`sb-${REF}-auth-token`, sess ? JSON.stringify(sess) : null, LANG]);
    await ligarCache(ctx);
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    try {
      // A rede desta maquina pendura pedidos de vez em quando: ate 3 tentativas.
      for (let tent = 1; ; tent++) {
        try {
          await page.goto(BASE + e.path, { waitUntil: "commit", timeout: 120000 });
          await page.waitForFunction(() => (document.getElementById("root")?.innerText || "").trim().length > 20, null, { timeout: 60000 });
          break;
        } catch (err) {
          if (tent >= 3) throw err;
        }
      }
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1500);
      if (e.acao) await e.acao(page);
      await auditarEstado(page, e.id, W, res);
      if (e.tabs) {
        // 1.a lista de separadores = topo; as outras que aparecerem dentro de cada
        // separador de topo sao percorridas por indice, sem depender do texto.
        const topo = page.locator('[role="tablist"]:visible').first();
        const nTopo = await topo.locator('[role="tab"]').count();
        for (let t = 0; t < nTopo; t++) {
          const tab = page.locator('[role="tablist"]:visible').first().locator('[role="tab"]').nth(t);
          const nomeT = (await tab.innerText()).trim().split(/\s|\(/)[0];
          await tab.click();
          await page.waitForTimeout(1000);
          await auditarEstado(page, `${e.id}~${nomeT}`, W, res);
          const listas = page.locator('[role="tablist"]:visible');
          const nListas = await listas.count();
          for (let l = 1; l < nListas; l++) {
            const nSub = await listas.nth(l).locator('[role="tab"]').count();
            for (let u = 0; u < nSub; u++) {
              const sub = page.locator('[role="tablist"]:visible').nth(l).locator('[role="tab"]').nth(u);
              const nomeS = (await sub.innerText()).trim().split(/\s|\(/)[0];
              await sub.click();
              await page.waitForTimeout(700);
              await auditarEstado(page, `${e.id}~${nomeT}~${nomeS}`, W, res);
            }
          }
        }
      }
    } catch (err) {
      console.log(`\x1b[33m!\x1b[0m ${e.id} @${W}: ${err.message.split("\n")[0]}`);
      res.push({ ecra: e.id, w: W, erro: err.message.split("\n")[0] });
      await page.screenshot({ path: `${SHOTS}/${e.id}-${W}-ERRO.png`, fullPage: true }).catch(() => {});
    }
    await ctx.close();
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
await browser.close();
writeFileSync(`${DIR}/resultado-${TAG}-${LANG}${FILTRO ? "-" + FILTRO : ""}.json`, JSON.stringify(res, null, 1));
