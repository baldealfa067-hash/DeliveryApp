/**
 * E2E: toggle de 3 opções no Explorar — "Serviços | Restaurantes | Beleza & Estética"
 * Confirma que cada opção troca a vista INTEIRA (título + categorias + lista)
 * e que nunca há mistura entre as três secções.
 *
 * Corre contra o dev server (vite) + Supabase live (chave anon, só leitura).
 */
const { chromium } = require("./node_modules/playwright");

const BASE = process.env.BASE_URL || "http://localhost:5199";
require("fs").readFile(".env", "utf8", async (err, envRaw) => {
  if (err) throw err;
  const vars = Object.fromEntries(
    envRaw
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
      })
  );
  const SB = vars.VITE_SUPABASE_URL;
  const KEY = vars.VITE_SUPABASE_PUBLISHABLE_KEY;
  const rest = (table) =>
    fetch(`${SB}/rest/v1/${table}?select=name`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })
      .then((r) => r.json())
      .then((rows) => rows.map((r) => r.name).sort());

  let ok = 0, fail = 0;
  const check = (label, cond, extra = "") => {
    console.log(`${cond ? "PASS" : "FAIL"} - ${label}${extra ? " | " + extra : ""}`);
    cond ? ok++ : fail++;
  };

  const [svcCats, bizCats, beaCats] = await Promise.all([
    rest("categories"), rest("business_categories"), rest("beauty_categories"),
  ]);
  check("BD: 3 tabelas de categorias acessíveis (anon)", svcCats.length > 0 && bizCats.length > 0 && beaCats.length === 10,
    `servicos=${svcCats.length} restaurantes=${bizCats.length} beleza=${beaCats.length}`);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);

  // ---- helpers -----------------------------------------------------------
  const ALL_LABEL = require("./src/i18n/locales/pt.json").common.all;
  const badgeTexts = () =>
    page.locator("div.flex-wrap.mb-4 > div.cursor-pointer").allTextContents();
  const cardLinks = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll("div.flex-col.gap-3 a[href^='/']"))
        .map((a) => a.getAttribute("href").split("/")[1])
    );
  const activeBadge = async () => {
    const badges = page.locator("div.flex-wrap.mb-4 > div.cursor-pointer");
    const n = await badges.count();
    for (let i = 0; i < n; i++) {
      const cls = await badges.nth(i).getAttribute("class");
      if (cls.includes("bg-primary") && !cls.includes("text-primary-foreground/")) return badges.nth(i).textContent();
    }
    return null;
  };
  const clickTab = async (name) => {
    await page.getByRole("button", { name, exact: true }).click();
    await page.waitForTimeout(1200); // troca de vista + fetch supabase
  };

  // ---- 1. Toggle tem as 3 opções com os rótulos exatos -------------------
  await page.goto(`${BASE}/explorar`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { level: 1 }).waitFor();
  for (const name of ["Serviços", "Restaurantes", "Beleza & Estética"]) {
    check(`toggle mostra «${name}»`, await page.getByRole("button", { name, exact: true }).isVisible());
  }

  // ---- 2. Estado inicial: Serviços ---------------------------------------
  const expectSection = async ({ tipo, h1, cats, linkPrefix, label }) => {
    const heading = await page.getByRole("heading", { level: 1 }).textContent();
    check(`${label}: título da vista = «${h1}»`, heading.trim() === h1, `obtido: «${heading.trim()}»`);
    if (tipo) check(`${label}: URL ?tipo=${tipo}`, page.url().includes(`tipo=${tipo}`));
    const badges = (await badgeTexts()).filter((b) => b !== ALL_LABEL).sort();
    const expected = [...cats].sort();
    check(
      `${label}: categorias = EXATAMENTE as ${cats.length} dessa secção (sem mistura)`,
      JSON.stringify(badges) === JSON.stringify(expected),
      `${badges.length} visíveis`
    );
    const others = [
      ...bizCats.filter((c) => !cats.includes(c)),
      ...beaCats.filter((c) => !cats.includes(c)),
      ...svcCats.filter((c) => !cats.includes(c)),
    ].filter((c) => badges.includes(c));
    check(`${label}: nenhuma categoria das outras secções presente`, others.length === 0,
      others.length ? `intrusas: ${others.join(", ")}` : "");
    const prefixes = await cardLinks();
    if (prefixes.length > 0) {
      check(`${label}: todos os cartões são de ${linkPrefix} (${prefixes.length})`,
        prefixes.every((p) => p === linkPrefix.replace(/\//g, "")) ||
          prefixes.every((p) => `/${p}` === linkPrefix),
        `[${Array.from(new Set(prefixes)).join(", ")}]`);
    } else {
      console.log(`INFO - ${label}: sem cartões na BD para validar prefixo de link`);
    }
  };

  await expectSection({ h1: "Prestadores de Serviço", cats: svcCats, linkPrefix: "/prestador/", label: "Serviços (default)" });

  // ---- 3. Trocar para Restaurantes ---------------------------------------
  await clickTab("Restaurantes");
  await expectSection({ tipo: "lojas", h1: "Restaurantes", cats: bizCats, linkPrefix: "/loja/", label: "Restaurantes" });

  // ---- 4. Trocar para Beleza & Estética ----------------------------------
  await clickTab("Beleza & Estética");
  await expectSection({ tipo: "beleza", h1: "Beleza & Estética", cats: beaCats, linkPrefix: "/beleza/", label: "Beleza & Estética" });

  // ---- 5. Sem mistura ao escolher categoria e depois trocar --------------
  const firstCat = (await badgeTexts()).find((b) => b !== ALL_LABEL);
  await page.locator("div.flex-wrap.mb-4 > div.cursor-pointer", { hasText: firstCat }).first().click();
  await page.waitForTimeout(600);
  check(`Beleza: escolher categoria «${firstCat}» fica ativa`, (await activeBadge()) === firstCat);
  check("Beleza: URL guarda ?categoria=", page.url().includes("categoria="));

  await clickTab("Serviços");
  const headingSvc = (await page.getByRole("heading", { level: 1 }).textContent()).trim();
  check("trocar depois de escolher categoria: vai para Serviços", headingSvc === "Prestadores de Serviço");
  check("trocar de secção limpa a categoria anterior (URL sem categoria=)", !page.url().includes("categoria="));
  check("trocar de secção volta a ativar «Todos»", (await activeBadge()) === ALL_LABEL);

  // ---- 6. Voltar a Beleza: vista intacta e consistente -------------------
  await clickTab("Beleza & Estética");
  const badgesBeleza2 = (await badgeTexts()).filter((b) => b !== ALL_LABEL).sort();
  check("voltar a Beleza: mesmas categorias, sem mistura",
    JSON.stringify(badgesBeleza2) === JSON.stringify([...beaCats].sort()));

  // ---- 7. Robustez: ?tipo inválido cai em Serviços (não parte, não mistura)
  await page.goto(`${BASE}/explorar?tipo=qualquercoisa`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { level: 1 }).waitFor();
  check("?tipo inválido → fallback Serviços sem crash",
    (await page.getByRole("heading", { level: 1 }).textContent()).trim() === "Prestadores de Serviço");

  // ---- 8. Início (/inicio): cartões de entrada levam ao Explorar ---------
  await page.goto(`${BASE}/inicio`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("card-servicos").waitFor();
  for (const [tipo, name] of [["servicos", "Serviços"], ["lojas", "Restaurantes"], ["beleza", "Beleza & Estética"]]) {
    check(`/inicio tem cartão de entrada «${name}»`, await page.getByTestId(`card-${tipo}`).isVisible());
  }
  await page.getByTestId("card-beleza").click();
  await page.waitForURL(/\/explorar\?tipo=beleza/);
  await page.getByRole("heading", { level: 1 }).waitFor();
  check("/inicio → cartão Beleza abre Explorar com h1 correto",
    (await page.getByRole("heading", { level: 1 }).textContent()).trim() === "Beleza & Estética");

  await browser.close();
  console.log(`\n${ok} pass / ${fail} fail`);
  process.exit(fail ? 1 : 0);
});
