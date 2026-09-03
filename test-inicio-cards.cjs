/**
 * E2E: novo layout do «Início» — logo (1x), pesquisa, localização e
 * 3 cartões grandes empilhados (Serviços | Restaurantes | Beleza & Estética)
 * que funcionam só como pontos de entrada para /explorar?tipo=...
 *
 * Valida também: sem destaques/populares no Início, sem duplicação de logo
 * e sem elementos cortados/overflow no telemóvel.
 *
 * Corre contra o dev server (vite) + Supabase live (chave anon, só leitura).
 */
const { chromium } = require("./node_modules/playwright");

const BASE = process.env.BASE_URL || "http://localhost:5199";
require("fs").readFile(".env", "utf8", async (err) => {
  if (err) throw err;

  let ok = 0, fail = 0;
  const check = (label, cond, extra = "") => {
    console.log(`${cond ? "PASS" : "FAIL"} - ${label}${extra ? " | " + extra : ""}`);
    cond ? ok++ : fail++;
  };

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 412, height: 915 } }); // telemóvel Android típico
  page.setDefaultTimeout(20000);

  const CARDS = [
    { tipo: "servicos", title: "Serviços", tagline: "Encontra profissionais", h1: "Prestadores de Serviço" },
    { tipo: "lojas", title: "Restaurantes", tagline: "Descobre menus", h1: "Restaurantes" },
    { tipo: "beleza", title: "Beleza & Estética", tagline: "Cuida de ti", h1: "Beleza & Estética" },
  ];

  // ---- 1. Estrutura do Início --------------------------------------------
  await page.goto(`${BASE}/inicio`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("card-servicos").waitFor();

  const logos = await page.locator('header img[alt="Bornaal"], main img[alt="Bornaal"], div img[alt="Bornaal"]').count();
  check("exatamente 1 logo Bornaal na página (sem duplicação)", logos === 1, `encontrados: ${logos}`);

  const searchVisible = await page.locator("form input").first().isVisible();
  check("barra de pesquisa visível", searchVisible);
  check(
    "localização «Bissau, Guiné-Bissau» visível",
    await page.getByText("Bissau, Guiné-Bissau").first().isVisible()
  );

  // ---- 2. Os 3 cartões: título + frase + foto carregada -------------------
  for (const c of CARDS) {
    const card = page.getByTestId(`card-${c.tipo}`);
    check(`cartão «${c.title}» visível`, await card.isVisible());
    const txt = (await card.textContent()) || "";
    check(`cartão «${c.title}» tem título + frase`, txt.includes(c.title) && txt.includes(c.tagline), txt.trim().slice(0, 60));
    const imgOk = await card.evaluate((el) => {
      const img = el.querySelector("img");
      return !!img && img.complete && img.naturalWidth > 50;
    });
    check(`cartão «${c.title}» com foto de fundo carregada`, imgOk);
  }

  // ---- 3. Sem destaques/populares: nenhum link de detalhe no Início -------
  const detailLinks = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href^='/prestador/'], a[href^='/loja/'], a[href^='/beleza/']")).length
  );
  check("sem populares/destaques (nenhum link de detalhe de negócio)", detailLinks === 0, `${detailLinks} links`);

  // ---- 4. Tocar em cada cartão leva ao Explorar com a categoria certa ----
  for (const c of CARDS) {
    await page.goto(`${BASE}/inicio`, { waitUntil: "domcontentloaded" });
    await page.getByTestId(`card-${c.tipo}`).click();
    await page.waitForURL(new RegExp(`\\/explorar\\?tipo=${c.tipo}`));
    await page.getByRole("heading", { level: 1 }).waitFor();
    const h1 = (await page.getByRole("heading", { level: 1 }).textContent()).trim();
    check(`cartão «${c.title}» → Explorar mostra «${c.h1}»`, h1 === c.h1, `h1: «${h1}» | url: ${page.url()}`);
    const activeTab = await page.getByRole("button", { name: c.h1 === "Prestadores de Serviço" ? "Serviços" : c.h1, exact: true }).getAttribute("class");
    check(`toggle em Explorar com «${c.h1}» ativo`, activeTab.includes("bg-background"));
  }

  // ---- 5. Telemóvel: nada cortado, sem overflow horizontal ---------------
  for (const vp of [{ width: 360, height: 640 }, { width: 412, height: 915 }]) {
    await page.setViewportSize(vp);
    await page.goto(`${BASE}/inicio`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("card-beleza").waitFor();
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    check(`${vp.width}px: sem scroll horizontal (${overflow}px)`, overflow <= 1);
    let allInside = true, worst = "";
    for (const c of CARDS) {
      const box = await page.getByTestId(`card-${c.tipo}`).boundingBox();
      if (!box || box.x < -1 || box.x + box.width > vp.width + 1) {
        allInside = false;
        worst = `${c.tipo}: ${JSON.stringify(box)}`;
      }
    }
    check(`${vp.width}px: os 3 cartões cabem na largura do ecrã`, allInside, worst);
    const logoBox = await page.locator('img[alt="Bornaal"]').first().boundingBox();
    check(`${vp.width}px: logo dentro do ecrã`, !!logoBox && logoBox.x >= 0 && logoBox.x + logoBox.width <= vp.width + 1);
  }

  await browser.close();
  console.log(`\n${ok} pass / ${fail} fail`);
  process.exit(fail ? 1 : 0);
});
