#!/usr/bin/env node
/**
 * Pedido manual com entrega: o bairro e ESCOLHIDO, nunca escrito (2026-09-27).
 * HTTP real, JWT de utilizador normal, chave anon -- nunca service_role.
 *
 * O que tem de provar:
 *  1. Com entrega, sem bairro -> recusado.
 *  2. Bairro que nenhuma frota serve (o "cupilum" do pedido #12) -> recusado, e
 *     NAO fica pedido nenhum gravado (era isso que deixava o #12 preso).
 *  3. Bairro servido -> frota e taxa IGUAIS as de um create_order para o mesmo
 *     bairro. Mesma resolucao, nao uma logica paralela.
 *  4. Sem entrega continua a funcionar sem bairro (nao partir o balcao).
 *
 * Nao conclui pedido nenhum: nao escreve no ledger. A limpeza e impressa no fim.
 *
 *   node scripts/pedido-manual-bairro-test.mjs
 */
import { readFileSync } from "node:fs";

const env = { ...process.env };
try {
  for (const l of readFileSync(".env", "utf8").split("\n")) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch { /* opcional */ }
const URL_BASE = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!URL_BASE || !ANON) { console.error("Faltam variaveis do Supabase"); process.exit(1); }

const MARCA = `rlstest-${Date.now()}`;
// Bairro ficticio, so a frota de teste o serve: nenhum pedido real vai para ela.
const ZONA = `ZonaBairroManual${Date.now() % 100000}`;
const TAXA = 1750, PRECO = 4000;
let passou = 0, falhou = 0;
const ok = (n, d = "") => { passou++; console.log(`  \x1b[32m✓\x1b[0m ${n}${d ? ` — ${d}` : ""}`); };
const ko = (n, d = "") => { falhou++; console.log(`  \x1b[31m✗\x1b[0m ${n}${d ? ` — ${d}` : ""}`); };

const cab = (tok) => ({ apikey: ANON, Authorization: `Bearer ${tok}` });
async function signup(etq) {
  const r = await fetch(`${URL_BASE}/auth/v1/signup`, { method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: `${MARCA}-${etq}@deliveryapp.test`, password: "TesteBairro#2026", data: { name: etq } }) });
  const c = await r.json();
  if (!c.access_token) throw new Error(`signup ${etq}: ${JSON.stringify(c).slice(0, 200)}`);
  return { token: c.access_token, user_id: c.user.id };
}
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
const msg = (r) => String(r.corpo?.message ?? JSON.stringify(r.corpo ?? "")).slice(0, 160);

async function main() {
  console.log(`\nPedido manual: bairro da lista (${MARCA})\n`);
  const dono = await signup("dono");
  const cliente = await signup("cliente");
  const frota = await signup("frota");

  await rpc(dono.token, "register_as_business");
  const biz = (await tabela(dono.token, `profiles?select=id&user_id=eq.${dono.user_id}`)).corpo?.[0]?.id;
  const item = (await tabela(dono.token, "menu_items", { method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ business_id: biz, name: `Prato ${MARCA}`, price: PRECO }) })).corpo?.[0]?.id;
  await rpc(frota.token, "create_fleet", { p_name: `Frota ${MARCA}`, p_phone: `9${String(Date.now()).slice(-7)}` });
  const zona = await rpc(frota.token, "upsert_zone_price", { p_bairro: ZONA, p_preco: TAXA });
  if (!biz || !item || zona.status >= 400) throw new Error(`preparacao: biz=${biz} item=${item} zona=${zona.status}`);

  const contar = async () => (await tabela(dono.token, `orders?select=id&business_id=eq.${biz}`)).corpo?.length ?? -1;
  const manual = (extra) => rpc(dono.token, "create_manual_order", {
    p_business_id: biz, p_items: [{ menu_item_id: item, qty: 1 }],
    p_customer_name: "Sr. Mane", p_customer_phone: "955111222", p_address: "Perto da mesquita", ...extra,
  });

  console.log("1. Entrega sem bairro");
  for (const [rot, b] of [["nulo", null], ["vazio", ""], ["so espacos", "   "]]) {
    const antes = await contar();
    const r = await manual({ p_consumption_option: "entrega", p_bairro: b });
    const depois = await contar();
    r.status >= 400 && /Escolha o bairro/.test(msg(r)) && depois === antes
      ? ok(`bairro ${rot}: recusado, nenhum pedido gravado`, msg(r))
      : ko(`bairro ${rot}: nao foi recusado pela regra`, `HTTP ${r.status} ${msg(r)} (${antes}->${depois})`);
  }

  console.log("\n2. Bairro que nenhuma frota serve (o caso do #12)");
  {
    const antes = await contar();
    const r = await manual({ p_consumption_option: "entrega", p_bairro: `cupilum-${MARCA}` });
    const depois = await contar();
    r.status >= 400 && /Nenhuma frota entrega/.test(msg(r))
      ? ok("recusado com a razao certa", msg(r))
      : ko("aceitou um bairro sem frota", `HTTP ${r.status} ${msg(r)}`);
    depois === antes ? ok("e nao ficou pedido preso", `${antes} -> ${depois}`) : ko("GRAVOU O PEDIDO na mesma", `${antes} -> ${depois}`);
  }

  console.log("\n3. Bairro servido: a mesma resolucao do create_order");
  let idManual = null;
  {
    const r = await manual({ p_consumption_option: "entrega", p_bairro: ZONA });
    idManual = typeof r.corpo === "string" ? r.corpo : null;
    idManual ? ok("pedido manual com entrega criado") : ko("recusou um bairro servido", `HTTP ${r.status} ${msg(r)}`);
  }
  const app = await rpc(cliente.token, "create_order", {
    p_business_id: biz, p_customer_id: cliente.user_id, p_customer_name: "Cliente App", p_customer_phone: "955333444",
    p_items: [{ menu_item_id: item, name: `Prato ${MARCA}`, price: PRECO, qty: 1 }], p_total: PRECO,
    p_consumption_option: "entrega", p_bairro: ZONA, p_address: "Casa azul", p_payment_method: "entrega",
  });
  const idApp = typeof app.corpo === "string" ? app.corpo : null;
  if (!idApp) ko("create_order de controlo falhou", `HTTP ${app.status} ${msg(app)}`);
  const ler = async (id) => (await tabela(dono.token, `orders?select=fleet_id,delivery_fee,bairro,source,status&id=eq.${id}`)).corpo?.[0];
  const m = idManual ? await ler(idManual) : null;
  const a = idApp ? await ler(idApp) : null;
  m && a && m.fleet_id && m.fleet_id === a.fleet_id
    ? ok("mesma frota que o create_order")
    : ko("frota diferente do create_order", `${m?.fleet_id} vs ${a?.fleet_id}`);
  m && a && Number(m.delivery_fee) === TAXA && Number(m.delivery_fee) === Number(a.delivery_fee)
    ? ok(`mesma taxa que o create_order`, `${m.delivery_fee} FCFA, a que a frota definiu`)
    : ko("taxa diferente", `${m?.delivery_fee} vs ${a?.delivery_fee} (esperado ${TAXA})`);
  const preco = (await rpc(dono.token, "get_delivery_price", { p_bairro: ZONA })).corpo?.[0];
  preco && Number(preco.preco) === Number(m?.delivery_fee)
    ? ok("e a mesma que o ecra mostra (get_delivery_price)")
    : ko("o ecra mostraria outra taxa", `${preco?.preco} vs ${m?.delivery_fee}`);
  m?.source === "manual" && m?.status === "confirmado"
    ? ok("continua manual e nasce confirmado") : ko("estado/source errado", JSON.stringify(m));

  console.log("\n4. Sem entrega, o bairro nao e pedido");
  {
    const r = await manual({ p_consumption_option: "para_levar", p_bairro: null });
    typeof r.corpo === "string" ? ok("para levar sem bairro continua a funcionar")
      : ko("partiu o pedido de balcao", `HTTP ${r.status} ${msg(r)}`);
  }

  console.log(`\n${passou} passaram · ${falhou} falharam`);
  console.log(`\nLIMPEZA (nenhum pedido foi concluido: o ledger nao foi tocado):
DO $$
DECLARE v_users uuid[]; v_profiles uuid[]; v_fleets uuid[]; v_orders uuid[]; n int;
BEGIN
  SELECT array_agg(id) INTO v_users FROM auth.users WHERE email LIKE '${MARCA}-%@deliveryapp.test';
  IF v_users IS NULL THEN RAISE NOTICE 'nada a limpar'; RETURN; END IF;
  SELECT array_agg(id) INTO v_profiles FROM public.profiles WHERE user_id = ANY(v_users);
  SELECT array_agg(id) INTO v_fleets   FROM public.fleets   WHERE owner_user_id = ANY(v_users);
  SELECT array_agg(id) INTO v_orders   FROM public.orders   WHERE business_id = ANY(COALESCE(v_profiles,'{}'::uuid[]));
  SELECT count(*) INTO n FROM public.orders WHERE id = ANY(COALESCE(v_orders,'{}'::uuid[]))
     AND customer_id IS NOT NULL AND NOT (customer_id = ANY(v_users));
  IF n > 0 THEN RAISE EXCEPTION 'ha % pedidos de clientes REAIS -- abortado', n; END IF;
  SELECT count(*) INTO n FROM public.ledger_entries WHERE order_id = ANY(COALESCE(v_orders,'{}'::uuid[]));
  IF n > 0 THEN RAISE EXCEPTION 'ha % lancamentos no ledger -- abortado', n; END IF;
  DELETE FROM public.order_status_history WHERE order_id = ANY(COALESCE(v_orders,'{}'::uuid[]));
  DELETE FROM public.stock_adjustments    WHERE order_id = ANY(COALESCE(v_orders,'{}'::uuid[]));
  DELETE FROM public.order_items          WHERE order_id = ANY(COALESCE(v_orders,'{}'::uuid[]));
  DELETE FROM public.orders               WHERE id = ANY(COALESCE(v_orders,'{}'::uuid[]));
  DELETE FROM public.menu_items           WHERE business_id = ANY(COALESCE(v_profiles,'{}'::uuid[]));
  DELETE FROM public.fleet_zone_prices    WHERE fleet_id = ANY(COALESCE(v_fleets,'{}'::uuid[]));
  DELETE FROM public.fleets               WHERE id = ANY(COALESCE(v_fleets,'{}'::uuid[]));
  DELETE FROM public.notifications        WHERE user_id = ANY(v_users);
  DELETE FROM public.user_roles           WHERE user_id = ANY(v_users);
  DELETE FROM public.profiles             WHERE user_id = ANY(v_users);
  DELETE FROM auth.users                  WHERE id = ANY(v_users);
END $$;`);
}

main()
  .catch((e) => ko("ERRO", e.message))
  .finally(() => process.exit(falhou > 0 ? 1 : 0));
