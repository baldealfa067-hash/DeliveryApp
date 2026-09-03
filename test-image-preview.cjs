/**
 * E2E: clicar na foto de um item (beleza/restaurante) abre popup de preview.
 * Valida que o modal abre com a imagem grande e fecha com Escape.
 */
const { chromium } = require("./node_modules/playwright");

const BASE = process.env.BASE_URL || "http://localhost:8080";

const BEAUTY_ID = "5605c724-1a9a-489e-9bf0-44d1bb625191";
const BIZ_ID = "24f51443-5344-40a3-8a7a-f42dbb0c41ed";

(async () => {
  let ok = 0, fail = 0;
  const check = (label, cond, extra = "") => {
    console.log(`${cond ? "PASS" : "FAIL"} - ${label}${extra ? " | " + extra : ""}`);
    cond ? ok++ : fail++;
  };

  const browser = await chromium.launch();

  // ---- 1. Beleza: foto do item abre preview ----
  {
    const page = await browser.newPage();
    page.setDefaultTimeout(20000);
    await page.goto(`${BASE}/beleza/${BEAUTY_ID}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1 }).waitFor();

    const imgs = page.locator(".h-14.w-14.cursor-pointer");
    const count = await imgs.count();
    check("beleza: itens com foto clicável presentes", count > 0, `count=${count}`);
    if (count > 0) {
      await imgs.first().click();
      const dialog = page.locator("[data-state='open'][role='dialog']");
      await dialog.waitFor({ state: "visible", timeout: 5000 });
      check("beleza: modal abre ao clicar na foto", await dialog.isVisible());
      const modalImg = dialog.locator("img");
      const src = await modalImg.getAttribute("src");
      check("beleza: modal mostra a imagem com src válido", !!src && src.startsWith("http"), src?.slice(0, 60));
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden", timeout: 5000 });
      check("beleza: modal fecha com Escape", !(await dialog.isVisible()));
    }
    await page.close();
  }

  // ---- 2. Restaurante: foto do prato abre preview ----
  {
    const page = await browser.newPage();
    page.setDefaultTimeout(20000);
    await page.goto(`${BASE}/loja/${BIZ_ID}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1 }).waitFor();

    const imgs = page.locator(".h-14.w-14.cursor-pointer");
    const count = await imgs.count();
    check("restaurante: itens com foto clicável presentes", count > 0, `count=${count}`);
    if (count > 0) {
      await imgs.first().click();
      const dialog = page.locator("[data-state='open'][role='dialog']");
      await dialog.waitFor({ state: "visible", timeout: 5000 });
      check("restaurante: modal abre ao clicar na foto", await dialog.isVisible());
      const modalImg = dialog.locator("img");
      const src = await modalImg.getAttribute("src");
      check("restaurante: modal mostra a imagem com src válido", !!src && src.startsWith("http"), src?.slice(0, 60));
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden", timeout: 5000 });
      check("restaurante: modal fecha com Escape", !(await dialog.isVisible()));
    }
    await page.close();
  }

  await browser.close();
  console.log(`\n${ok} pass / ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
