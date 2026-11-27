// Run on a private server or a scheduled job. Tokens never go in a client build.
import { rename, readFile, writeFile } from "node:fs/promises";

const config = (prefix) => {
  const url = process.env[`${prefix}_SUPABASE_URL`];
  const key = process.env[`${prefix}_SUPABASE_KEY`];
  const token = process.env[`${prefix}_ORDER_TOKEN`];
  if (!url || !key || !/^[a-f0-9]{64}$/.test(token ?? "")) throw new Error(`Missing configuration for ${prefix}`);
  if (new URL(url).protocol !== "https:") throw new Error(`HTTPS required for ${prefix}`);
  return { url, key, token };
};
const source = new URL("/api/partner-orders", process.env.ITUDOO_URL || "https://www.itudoo.com");
const sourceToken = process.env.ITUDOO_ORDER_TOKEN;
if (source.protocol !== "https:" || !/^[a-f0-9]{64}$/.test(sourceToken ?? "")) {
  throw new Error("HTTPS and ITUDOO_ORDER_TOKEN are required");
}

async function iTudoo({ cursor, orderId, action }) {
  const url = new URL(source);
  if (cursor?.time) {
    url.searchParams.set("after", cursor.time);
    url.searchParams.set("after_id", cursor.id);
  }
  const response = await fetch(url, {
    method: orderId ? "POST" : "GET",
    redirect: "error",
    headers: { Authorization: `Bearer ${sourceToken}`, "Content-Type": "application/json" },
    body: orderId ? JSON.stringify({ order_id: orderId, action }) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`iTudoo orders API: HTTP ${response.status}`);
  return response.json();
}
const destination = config("GESTAO_PRO");
const cursorPath = process.env.ORDER_SYNC_CURSOR;
if (!cursorPath) throw new Error("ORDER_SYNC_CURSOR is required");

async function rpc(connection, name, data = {}) {
  const response = await fetch(new URL(`/rest/v1/rpc/${name}`, connection.url), {
    method: "POST",
    headers: { apikey: connection.key, "Content-Type": "application/json" },
    body: JSON.stringify({ p_token: connection.token, ...data }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const result = await response.text();
  return result ? JSON.parse(result) : null;
}

async function run() {
  const cursor = await readFile(cursorPath, "utf8").then(JSON.parse).catch((error) => {
    if (error.code === "ENOENT") return { time: null, id: null };
    throw error;
  });

  // Each acknowledgement is reflected by the next authoritative order snapshot.
  const actions = await rpc(destination, "get_external_order_actions");
  let failed = false;
  for (const action of actions) {
    try {
      await iTudoo({
        orderId: action.external_id, action: action.requested_status,
      });
    } catch (error) {
      console.error(error.message);
      failed = true;
    }
  }

  // Replay a short overlap to cover transactions that commit out of timestamp order.
  let after = cursor.time ? {
    time: new Date(Date.parse(cursor.time) - 120000).toISOString(),
    id: "00000000-0000-0000-0000-000000000000",
  } : cursor;
  let count = 0;
  for (;;) {
    const { orders } = await iTudoo({ cursor: after });
    for (const order of orders) {
      await rpc(destination, "sync_external_order", { p_order: order.payload });
      after = { time: order.updated_at, id: order.id };
      count += 1;
    }
    if (orders.length < 100) break;
  }
  const temporary = `${cursorPath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(count ? after : cursor), { mode: 0o600 });
  await rename(temporary, cursorPath);
  console.log(`Synced ${count} order snapshots; processed ${actions.length} queued actions.`);
  if (failed) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
