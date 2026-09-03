const { createClient } = require("./node_modules/@supabase/supabase-js/dist/index.cjs");
const WebSocket = require("./node_modules/ws");
const mk = (url, key) => createClient(url, key, { realtime: { transport: WebSocket } });
require("fs").readFile(".env", "utf8", async (err, env) => {
  if (err) throw err;
  const vars = Object.fromEntries(env.split("\n").filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
  }));
  const supabase = mk(vars.VITE_SUPABASE_URL, vars.VITE_SUPABASE_PUBLISHABLE_KEY);
  const stamp = Date.now();
  const email = `teste.beleza.${stamp}@bornaal.test`;
  const pass = "teste1234";
  let ok = 0, fail = 0;
  const check = (label, cond, extra = "") => {
    console.log(`${cond ? "PASS" : "FAIL"} - ${label}${extra ? " | " + extra : ""}`);
    cond ? ok++ : fail++;
  };

  // 1. Registo de conta Beleza & Estética (como no Login.tsx)
  const { data: su, error: suErr } = await supabase.auth.signUp({
    email, password: pass,
    options: { emailRedirectTo: `${"https://x.test"}/painel`, data: { name: "Salão Beleza Teste" } },
  });
  check("signup com sessão", !suErr && !!su.session, suErr?.message ?? "");
  const uid = su.user.id;

  // 2. rpc register_as_beleza
  const { error: rErr } = await supabase.rpc("register_as_beleza");
  check("rpc register_as_beleza", !rErr, rErr?.message ?? "");

  // 3. Subcategorias seeded visíveis (público)
  const { data: cats, error: cErr } = await supabase.from("beauty_categories").select("id, name").order("name");
  check("beauty_categories legíveis (anon)", !cErr && cats.length === 10, `${cats?.length} categorias`);

  // 4. Carregar perfil auto-criado pelo trigger handle_new_user (como o useEffect
  //    do BeautyEdit faz) e depois guardar os dados (update), como na UI real.
  const { data: existing } = await supabase.from("profiles").select("*").eq("user_id", uid).maybeSingle();
  const catName = cats.find((c) => c.name === "Salão de Beleza")?.name;
  const payload = {
    name: "Salão Beleza Teste",
    category: catName,
    phone: "+245 900000000",
    location: "Bissau",
    description: "Negócio de teste da categoria Beleza & Estética.",
    photo_url: null,
    consumption_options: [],
    profile_type: "beleza",
    price_type: "combinar",
  };
  const { data: prof, error: pErr } = existing
    ? await supabase.from("profiles").update(payload).eq("id", existing.id).select().single()
    : await supabase.from("profiles").insert({ ...payload, user_id: uid }).select().single();
  check(existing ? "update perfil existente -> beleza" : "insert profile (profile_type='beleza')", !pErr && !!prof, pErr?.message ?? "");

  // 5. Item com PREÇO FIXO
  const { data: itFixo, error: eFixo } = await supabase
    .from("beauty_items")
    .insert({ business_id: prof.id, name: "Corte simples", price_type: "fixo", price: 1500, photo_url: null })
    .select()
    .single();
  check("item preço fixo (1500)", !eFixo && itFixo.price === 1500 && itFixo.price_type === "fixo", eFixo?.message ?? "");

  // 6. Item NEGOCIÁVEL (sem valor)
  const { data: itNeg, error: eNeg } = await supabase
    .from("beauty_items")
    .insert({ business_id: prof.id, name: "Tranças", price_type: "negociavel", price: null, photo_url: null })
    .select()
    .single();
  check("item negociável (price=null)", !eNeg && itNeg.price === null && itNeg.price_type === "negociavel", eNeg?.message ?? "");

  // 7. Negativo: negociavel COM preço deve falhar (CHECK)
  const bad1 = await supabase
    .from("beauty_items")
    .insert({ business_id: prof.id, name: "X", price_type: "negociavel", price: 100 })
    .select()
    .single();
  check("negociavel com preço rejeitado pelo CHECK", !!bad1.error);

  // 8. Negativo: fixo SEM preço deve falhar (CHECK)
  const bad2 = await supabase
    .from("beauty_items")
    .insert({ business_id: prof.id, name: "Y", price_type: "fixo", price: null })
    .select()
    .single();
  check("fixo sem preço rejeitado pelo CHECK", !!bad2.error);

  // 9. Leitura pública (como BeautyDetail faz, via cliente ANON sem login)
  const anon = mk(vars.VITE_SUPABASE_URL, vars.VITE_SUPABASE_PUBLISHABLE_KEY);
  const { data: pubProfile } = await anon.from("profiles").select("*").eq("id", prof.id).maybeSingle();
  check("perfil público visível para visitantes", pubProfile?.profile_type === "beleza");
  const { data: pubItems } = await anon
    .from("beauty_items")
    .select("id, name, price_type, price")
    .eq("business_id", prof.id)
    .order("name");
  check(
    "catálogo público mostra 2 itens corretos",
    pubItems?.length === 2 &&
      pubItems.find((i) => i.name === "Corte simples")?.price === 1500 &&
      pubItems.find((i) => i.name === "Tranças")?.price === null,
    JSON.stringify(pubItems)
  );

  // 10. RLS: visitante NÃO consegue inserir itens
  const rl = await anon.from("beauty_items").insert({ business_id: prof.id, name: "Hack", price_type: "fixo", price: 1 }).select().single();
  check("RLS bloqueia insert anónimo em beauty_items", !!rl.error);

  // 11. Estatísticas de contacto (mesma RPC usada pelos botões WhatsApp/Ligar)
  const w = await anon.rpc("record_provider_contact", { p_provider_id: prof.id, contact_type: "whatsapp" });
  const c = await anon.rpc("record_provider_contact", { p_provider_id: prof.id, contact_type: "call" });
  check("record_provider_contact (whatsapp/call)", !w.error && !c.error, w.error?.message || c.error?.message || "");
  const { data: statsRow } = await anon.rpc("increment_provider_view", { p_provider_id: prof.id }).maybeSingle();

  console.log(`\n${ok} pass / ${fail} fail`);
  console.log(`EMAIL_TESTE=${email}\nSENHA_TESTE=${pass}\nPROFILE_ID=${prof.id}`);
  process.exit(fail ? 1 : 0);
});
