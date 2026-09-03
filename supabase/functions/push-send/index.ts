import webpush from "npm:web-push@3.6.7";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const vapidSubject = Deno.env.get("VAPID_SUBJECT")!;
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY")!;
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY")!;

webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const rest = (path: string) =>
  fetch(`${supabaseUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
    },
  });

interface SubscriptionRow {
  endpoint: string;
  keys: { p256dh?: string; auth?: string };
}

async function getSubscriptions(path: string): Promise<SubscriptionRow[]> {
  const res = await rest(path);
  if (!res.ok) throw new Error(`DB query failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<SubscriptionRow[]>;
}

function sendPush(
  sub: SubscriptionRow,
  payload: { title: string; body: string; url: string }
): Promise<{ ok: boolean; gone: boolean; status: number }> {
  return new Promise((resolve) => {
    const request = {
      endpoint: sub.endpoint,
      keys: {
        p256dh: sub.keys?.p256dh ?? "",
        auth: sub.keys?.auth ?? "",
      },
    } as webpush.PushSubscription;
    webpush
      .sendNotification(request, JSON.stringify(payload), { TTL: 86400 })
      .then(() => resolve({ ok: true, gone: false, status: 201 }))
      .catch((err) => {
        const status = err?.statusCode ?? 0;
        // Só remove subscrições definitivamente expiradas (404/410).
        // 400/403 podem ser transitórios (ex.: quota, auth momentâneo) — apagar aqui
        // eliminaria subscrições válidas de utilizadores reais.
        const gone = status === 404 || status === 410;
        resolve({ ok: false, gone, status, error: `${err?.name ?? ""}: ${err?.message ?? ""}`.slice(0, 200) });
      });
  });
}

interface PushPayload {
  kind?: string;
  user_id?: string;
  type?: string;
  title?: string;
  body?: string;
  link?: string;
  request_id?: string;
  location?: string;
  name?: string;
  category?: string;
  profile_type?: string;
  author_user_id?: string;
}

const cleanPhone = (p: string | null | undefined): string => (p ?? "").replace(/[^0-9]/g, "");

const firstProfile = async (path: string): Promise<Record<string, unknown> | undefined> => {
  const res = await rest(path);
  if (!res.ok) return undefined;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : undefined;
};

/**
 * Calcula o link WhatsApp para uma notificação:
 * - contacto: abre o WhatsApp do próprio (alguém clicou no teu botão).
 * - candidatura_*: abre o WhatsApp da OUTRA parte envolvida no pedido
 *   (candidato para o dono do pedido; cliente para o candidato).
 * - restantes: sem WhatsApp (a notificação abre a plataforma).
 */
async function whatsappUrlForNotification(p: PushPayload): Promise<string> {
  try {
    if (p.type === "contacto") {
      const profile = await firstProfile(`/rest/v1/profiles?user_id=eq.${p.user_id}&select=phone&limit=1`);
      const num = cleanPhone(profile?.phone as string | undefined);
      return num ? `https://wa.me/${num}` : "";
    }
    if (p.type?.includes("candidatura") && p.request_id) {
      const req = await firstProfile(
        `/rest/v1/service_requests?select=user_id,requester_phone&id=eq.${p.request_id}&limit=1`
      );
      if (!req) return "";
      if (req.user_id === p.user_id) {
        // Destinatário = dono do pedido → outra parte é o candidato (prestador/loja)
        const bid = await firstProfile(
          `/rest/v1/request_bids?select=provider_id&request_id=eq.${p.request_id}&order=created_at.desc&limit=1`
        );
        if (!bid?.provider_id) return "";
        const prov = await firstProfile(`/rest/v1/profiles?select=phone&id=eq.${bid.provider_id}&limit=1`);
        const num = cleanPhone(prov?.phone as string | undefined);
        return num ? `https://wa.me/${num}` : "";
      } else {
        // Destinatário = candidato → outra parte é o cliente
        const num = cleanPhone(req.requester_phone as string | undefined);
        return num ? `https://wa.me/${num}` : "";
      }
    }
  } catch {
    // nunca bloqueia o envio do push
  }
  return "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const payload = (await req.json()) as {
      kind?: "notification" | "novidades" | "debug";
      user_id?: string;
      type?: string;
      title?: string;
      body?: string;
      link?: string;
      request_id?: string;
      location?: string;
      name?: string;
      category?: string;
      profile_type?: string;
      author_user_id?: string;
    };

    if (payload.kind === "debug") {
      const pub = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
      const priv = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
      const sha = async (s: string) => {
        const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
        return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
      };
      const probes: Record<string, string> = {};
      for (const [name, url] of Object.entries({
        fcm: "https://fcm.googleapis.com/fcm/send/probe-test-token",
        google: "https://www.google.com",
        example: "https://example.com",
        supabase: supabaseUrl,
      })) {
        try {
          const r = await fetch(url, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
          probes[name] = `status=${r.status}`;
        } catch (e) {
          probes[name] = `ERR: ${(e as Error).message}`;
        }
      }
      return new Response(
        JSON.stringify({ pub_hash: await sha(pub), priv_hash: await sha(priv), pub_set: pub.length > 0, priv_set: priv.length > 0, probes }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    let subscriptions: SubscriptionRow[] = [];
    let pushes: { title: string; body: string; url: string; whatsapp_url?: string }[] = [];

    if (payload.kind === "notification") {
      if (!payload.user_id || !payload.title) {
        return new Response("missing user_id/title", { status: 400, headers: corsHeaders });
      }
      subscriptions = await getSubscriptions(
        `/rest/v1/push_subscriptions?user_id=eq.${payload.user_id}&push_enabled=eq.true&select=endpoint,keys`
      );
      const whatsappUrl = await whatsappUrlForNotification(payload);
      pushes = [{ title: payload.title, body: payload.body ?? "", url: payload.link ?? "/", whatsapp_url: whatsappUrl }];
    } else if (payload.kind === "novidades") {
      if (!payload.location) {
        return new Response("missing location", { status: 400, headers: corsHeaders });
      }
      // Utilizadores com a opção "novidades" ativa e no mesmo bairro
      const search = encodeURIComponent(`"${payload.location}"`);
      subscriptions = await getSubscriptions(
        `/rest/v1/push_subscriptions?push_enabled=eq.true&novidades=eq.true&select=endpoint,keys,user_id`
      );
      const filtered: SubscriptionRow[] = [];
      for (const s of subscriptions) {
        const profileRes = await rest(
          `/rest/v1/profiles?user_id=eq.${s.user_id}&select=location,user_id`
        );
        if (!profileRes.ok) continue;
        const profiles = await profileRes.json();
        const match =
          profiles.length > 0 &&
          profiles[0].location === payload.location &&
          (payload.author_user_id === "" || profiles[0].user_id !== payload.author_user_id);
        if (match) filtered.push(s);
      }
      subscriptions = filtered;
      const isBusiness = payload.profile_type === "business";
      const isBeleza = payload.profile_type === "beleza";
      const what = isBeleza ? "negócio de beleza & estética" : isBusiness ? "restaurante/loja" : "prestador";
      pushes = [
        {
          title: "Novidade perto de ti",
          body: `${payload.name ?? "Alguém"} — novo ${what} de ${payload.category ?? ""} em ${payload.location}.`,
          url: "/explorar",
        },
      ];
    } else {
      return new Response("unknown kind", { status: 400, headers: corsHeaders });
    }

    const results = await Promise.all(
      subscriptions.flatMap((sub) =>
        pushes.map((p) => sendPush(sub, p).then((r) => ({ endpoint: sub.endpoint, ...r })))
      )
    );

    // Remove subscrições definitivamente expiradas (404/410)
    const gone = results.filter((r) => r.gone);
    const deletes: number[] = [];
    for (const g of gone) {
      const del = await fetch(
        `${supabaseUrl}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(g.endpoint)}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey } }
      ).catch((e) => ({ status: -1, statusText: e.message }));
      deletes.push(del.status);
    }

    return new Response(
      JSON.stringify({
        sent: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        delete_statuses: deletes,
        failed_statuses: results.filter((r) => !r.ok).map((r) => ({ status: r.status, error: r.error ?? "" })),
        whatsapp_urls: pushes.map((p) => p.whatsapp_url ?? ""),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(`error: ${err.message}`, { status: 500, headers: corsHeaders });
  }
});