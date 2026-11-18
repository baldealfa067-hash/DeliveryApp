const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { ...cors, "Content-Type": "application/json" },
});

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "POST") return json({ error: "Método não permitido" }, 405);
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Sem sessão" }, 401);

  try {
    const body = await request.json();
    const { phone, name, role, fleetId, password } = body ?? {};
    if (typeof phone !== "string" || !/^[1-9][0-9]{6,8}$/.test(phone)
      || typeof name !== "string" || !name.trim() || name.trim().length > 100
      || !["business", "fleet", "driver"].includes(role)
      || (password != null && (typeof password !== "string" || !/^Dg1![a-f0-9]{40}$/.test(password)))) {
      return json({ error: "Verifique os dados do parceiro" }, 400);
    }

    const provision = () => fetch(`${url}/rest/v1/rpc/admin_provision_partner`, {
      method: "POST",
      headers: { Authorization: authorization, apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ p_phone: phone, p_name: name, p_role: role, p_fleet_id: fleetId ?? null }),
    });

    // The RPC authenticates the caller and checks their admin role before
    // looking up the phone. Only that successful check can reach Auth Admin.
    let result = await provision();
    if (!result.ok) return json({ error: (await result.json()).message }, result.status);
    if (await result.json()) return json({ ok: true, created: false });
    if (!password) return json({ needsPin: true });

    const create = await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `c${phone}@deliveryapp.gw`,
        password,
        email_confirm: true,
        user_metadata: { name: name.trim(), phone },
      }),
    });

    // Retry against the exact phone account even if another request created
    // it first. The database transaction is idempotent.
    result = await provision();
    if (!result.ok) return json({ error: (await result.json()).message }, result.status);
    if (!(await result.json())) return json({ error: "Não foi possível criar a conta" }, 502);
    return json({ ok: true, created: create.ok });
  } catch {
    return json({ error: "Não foi possível adicionar o parceiro" }, 500);
  }
});
