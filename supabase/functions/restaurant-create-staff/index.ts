const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});
const serviceHeaders = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, "Content-Type": "application/json" };

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  try {
    const { businessId, phone, pin, permissions } = (await request.json().catch(() => null)) ?? {};
    if (typeof businessId !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(businessId)
      || typeof phone !== "string" || !/^[1-9][0-9]{6,8}$/.test(phone)
      || typeof pin !== "string" || !/^\d{6}$/.test(pin)
      || !Array.isArray(permissions) || !permissions.length || permissions.length > 3
      || permissions.some((permission) => !["orders", "finance", "commission"].includes(permission))) {
      return json({ error: "invalid_staff" }, 400);
    }

    const authHeaders = { Authorization: authorization, apikey: anonKey, "Content-Type": "application/json" };
    const user = await fetch(`${url}/auth/v1/user`, { headers: authHeaders });
    if (!user.ok) return json({ error: "unauthorized" }, 401);
    const { id: ownerId } = await user.json();
    const owner = await fetch(`${url}/rest/v1/rpc/is_business_owner`, {
      method: "POST", headers: authHeaders, body: JSON.stringify({ p_business_id: businessId }),
    });
    if (!owner.ok || await owner.json() !== true) return json({ error: "forbidden" }, 403);

    const create = await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST", headers: serviceHeaders,
      body: JSON.stringify({ email: `r${phone}@deliveryapp.gw`, password: `DgStaff1!${phone}:${pin}`, email_confirm: true }),
    });
    if (!create.ok) {
      const failure = await create.json().catch(() => null);
      return ["email_exists", "user_already_exists"].includes(failure?.code ?? failure?.error_code)
        ? json({ error: "phone_taken" }, 409)
        : json({ error: "provision_failed" }, 502);
    }
    const { id: staffId } = await create.json();
    const assigned = await fetch(`${url}/rest/v1/rpc/provision_restaurant_staff_access`, {
      method: "POST", headers: serviceHeaders, body: JSON.stringify({
        p_owner_id: ownerId, p_business_id: businessId, p_user_id: staffId, p_permissions: permissions,
      }),
    });
    if (!assigned.ok) {
      // A rejected database transaction leaves no membership.
      if (assigned.status < 500) {
        await fetch(`${url}/auth/v1/admin/users/${staffId}`, { method: "DELETE", headers: serviceHeaders });
      }
      return json({ error: "provision_failed" }, 502);
    }
    return json({ ok: true });
  } catch {
    return json({ error: "provision_failed" }, 502);
  }
});
