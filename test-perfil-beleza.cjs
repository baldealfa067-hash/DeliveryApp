/**
 * E2E: página "Perfil" reconhece negócios de Beleza & Estética.
 * - Conta COM beleza (role 'beleza' + profile_type 'beleza'): /perfil mostra
 *   estatísticas do negócio + botão "Configurar negócio" e NUNCA
 *   "Tornar-me prestador".
 * - Conta SEM nenhum negócio: /perfil mostra a página genérica com
 *   "Tornar-me prestador" (comportamento original preservado).
 *
 * Corre contra o dev server (vite) + Supabase live.
 */
const { chromium } = require("./node_modules/playwright");
const { createClient } = require("./node_modules/@supabase/supabase-js/dist/index.cjs");
const WebSocket = require("./node_modules/ws");

const BASE = process.env.BASE_URL || "http://localhost:8080";
require("fs").readFile(".env", "utf8", async (err, envRaw) => {
  if (err) throw err;
  const vars = Object.fromEntries(
    envRaw.split("\n").filter((l) => l.includes("=")).map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    })
  );
  const supabase = createClient(vars.VITE_SUPABASE_URL, vars.VITE_SUPABASE_PUBLISHABLE_KEY, { realtime: { transport: WebSocket } });

  let ok = 0, fail = 0;
  const check = (label, cond, extra = "") => {
    console.log(`${cond ? "PASS" : "FAIL"} - ${label}${extra ? " | " + extra : ""}`);
    cond ? ok++ : fail++;
  };

  // ---------- setup: conta beleza (mesmo fluxo do Login.tsx) ---------------
  const stamp = Date.now();
  const belezaEmail = `teste.perfil.beleza.${stamp}@bornaal.test`;
  const plainEmail = `teste.perfil.plain.${stamp}@bornaal.test`;
  const pass = "teste1234";
  const BIZ_NAME = "Salão Perfil Teste";

  const su = await supabase.auth.signUp({ email: belezaEmail, password: pass, options: { data: { name: BIZ_NAME } } });
  check("signup conta beleza", !su.error && !!su.data.session, su.error?.message ?? "");
  await supabase.rpc("register_as_beleza");
  const cats = await supabase.from("beauty_categories").select("name").order("name");
  const catName = (cats.data ?? []).find((c) => c.name === "Cabeleireiro")?.name ?? (cats.data ?? [])[0]?.name;
  const { data: profRow } = await supabase.from("profiles").select("id").eq("user_id", su.data.user.id).maybeSingle();
  const up = await supabase.from("profiles").update({
    name: BIZ_NAME, category: catName, phone: "+245 900111222", location: "Bissau",
    description: "Negócio de teste E2E do Perfil.", profile_type: "beleza", price_type: "combinar",
  }).eq("id", profRow.id).select().single();
  check("perfil beleza criado (profile_type='beleza')", !up.error && up.data.profile_type === "beleza", up.error?.message ?? "");
  await supabase.auth.signOut();

  // conta sem nenhum negócio (perfil nomeado, sem roles)
  const sp = await supabase.auth.signUp({ email: plainEmail, password: pass, options: { data: { name: "Cliente Teste" } } });
  check("signup conta sem negócio", !sp.error && !!sp.data.session, sp.error?.message ?? "");
  const { data: plainRow } = await supabase.from("profiles").select("id").eq("user_id", sp.data.user.id).maybeSingle();
  if (plainRow) await supabase.from("profiles").update({ name: "Cliente Teste" }).eq("id", plainRow.id);
  await supabase.auth.signOut();

  // ---------- browser -------------------------------------------------------
  const loginAndVisitProfile = async (email) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.setDefaultTimeout(20000);
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(pass);
    await page.getByRole("button", { name: /entrar|iniciar/i }).click();
    await page.waitForURL(/\/(painel-beleza|inicio|painel-loja)/, { timeout: 20000 });
    await page.goto(`${BASE}/perfil`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1 }).waitFor();
    return { ctx, page };
  };

  const browser = await chromium.launch();

  // ---- caso 1: conta com negócio de Beleza & Estética ----------------------
  {
    const { ctx, page } = await loginAndVisitProfile(belezaEmail);
    await page.getByText(BIZ_NAME).first().waitFor({ timeout: 20000 }); // perfil carregado
    check("beleza: nome do negócio visível no Perfil", await page.getByText(BIZ_NAME).first().isVisible());
    await page.getByText("Estatísticas do perfil").waitFor({ timeout: 20000 });
    check("beleza: secção «Estatísticas do perfil» presente", await page.getByText("Estatísticas do perfil").isVisible());
    check("beleza: métrica vistas/WhatsApp presente", await page.getByText("vistas").first().isVisible() && await page.getByText("WhatsApp").first().isVisible());
    check("beleza: botão «Configurar negócio» presente", await page.getByRole("button", { name: "Configurar negócio" }).isVisible());
    const become = await page.getByRole("button", { name: "Tornar-me prestador" }).count();
    check("beleza: «Tornar-me prestador» NÃO aparece", become === 0, `contagem=${become}`);
    await page.getByRole("button", { name: "Configurar negócio" }).click();
    await page.waitForURL(/\/painel-beleza\/editar/, { timeout: 20000 });
    check("beleza: «Configurar negócio» abre o editor (/painel-beleza/editar)", page.url().includes("/painel-beleza/editar"));
    await ctx.close();
  }

  // ---- caso 2: conta sem nenhum negócio ------------------------------------
  {
    const { ctx, page } = await loginAndVisitProfile(plainEmail);
    await page.getByRole("button", { name: "Tornar-me prestador" }).waitFor({ timeout: 20000 }); // perfil carregado
    check("sem negócio: «Tornar-me prestador» presente", await page.getByRole("button", { name: "Tornar-me prestador" }).isVisible());
    check("sem negócio: sem estatísticas", (await page.getByText("Estatísticas do perfil").count()) === 0);
    check("sem negócio: sem «Configurar negócio»", (await page.getByRole("button", { name: "Configurar negócio" }).count()) === 0);
    await ctx.close();
  }

  await browser.close();
  console.log(`\n${ok} pass / ${fail} fail`);
  console.log(`EMAIL_BELEZA_TESTE=${belezaEmail}\nEMAIL_PLAIN_TESTE=${plainEmail}`);
  process.exit(fail ? 1 : 0);
});
