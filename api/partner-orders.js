import { defaultSupabasePublishableKey, defaultSupabaseUrl } from "../src/integrations/supabase/publicConfig.js";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const actions = new Set(["accepted", "preparing", "ready", "completed", "cancelled"]);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const token = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization ?? "")?.[1];
  if (!token) return res.status(401).json({ error: "invalid_credentials" });

  const reading = req.method === "GET";
  let input;
  if (reading) {
    const { after, after_id: afterId } = req.query ?? {};
    if ((after != null || afterId != null)
      && (typeof after !== "string" || !Number.isFinite(Date.parse(after))
        || typeof afterId !== "string" || !uuid.test(afterId))) {
      return res.status(400).json({ error: "invalid_cursor" });
    }
    input = { p_after: after ?? null, p_after_id: afterId ?? null };
  } else {
    const { order_id: orderId, action } = req.body ?? {};
    if (typeof orderId !== "string" || !uuid.test(orderId) || !actions.has(action)) {
      return res.status(400).json({ error: "invalid_action" });
    }
    input = { p_order_id: orderId, p_action: action };
  }

  const rpc = reading ? "list_partner_orders" : "apply_partner_order_action";
  const url = process.env.VITE_SUPABASE_URL || defaultSupabaseUrl;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || defaultSupabasePublishableKey;
  try {
    const response = await fetch(new URL(`/rest/v1/rpc/${rpc}`, url), {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ p_token: token, ...input }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await response.json();
    if (!response.ok) {
      if (data.code === "42501") return res.status(403).json({ error: "access_denied" });
      if (data.code === "P0001") return res.status(409).json({ error: "order_state_conflict" });
      return res.status(502).json({ error: "upstream_unavailable" });
    }
    return res.status(200).json(reading ? { orders: data } : { status: data });
  } catch {
    return res.status(502).json({ error: "upstream_unavailable" });
  }
}
