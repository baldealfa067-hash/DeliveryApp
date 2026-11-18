const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const inviteRedirect = Deno.env.get("PARTNER_INVITE_REDIRECT_URL") ?? "https://itudoo.com/redefinir-senha";
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
    const { email: rawEmail, phone, name, role, fleetId } = (await request.json()) ?? {};
    const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.endsWith("@deliveryapp.gw")
      || typeof phone !== "string" || !/^[1-9][0-9]{6,8}$/.test(phone)
      || typeof name !== "string" || !name.trim() || name.trim().length > 100
      || !["business", "fleet", "driver"].includes(role)) {
      return json({ error: "Verifique os dados do parceiro" }, 400);
    }

    const provision = () => fetch(`${url}/rest/v1/rpc/admin_provision_partner_by_email`, {
      method: "POST",
      headers: { Authorization: authorization, apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ p_email: email, p_phone: phone, p_name: name, p_role: role, p_fleet_id: fleetId ?? null }),
    });

    // This call verifies the administrator before the service key is used.
    let result = await provision();
    if (!result.ok) return json({ error: (await result.json()).message }, result.status);
    if (await result.json()) return json({ ok: true, invited: false });

    const invite = await fetch(`${url}/auth/v1/invite?redirect_to=${encodeURIComponent(inviteRedirect)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, data: { name: name.trim() } }),
    });
    if (!invite.ok) {
      const failure = await invite.json().catch(() => null);
      const code = failure?.error_code ?? failure?.code;
      if (code === "email_address_invalid") {
        return json({ error: "O Supabase rejeitou este endereço. Confirme o e-mail com o parceiro e use um endereço válido." }, 400);
      }
      if (code === "email_address_not_authorized") {
        return json({ error: "O envio para endereços externos requer SMTP personalizado no Supabase." }, 502);
      }
      if (invite.status === 429) {
        return json({ error: "Limite de envio atingido. Tente novamente mais tarde." }, 429);
      }
      return json({ error: "O Supabase não enviou o convite. Verifique os logs de autenticação e a configuração de envio." }, 502);
    }

    result = await provision();
    if (!result.ok) return json({ error: (await result.json()).message }, result.status);
    if (!(await result.json())) return json({ error: "O convite foi enviado. Volte a submeter o formulário para ativar o parceiro." }, 502);
    return json({ ok: true, invited: true });
  } catch {
    return json({ error: "Não foi possível adicionar o parceiro" }, 500);
  }
});
