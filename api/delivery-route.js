// A best-effort throttle per warm Vercel instance. The provider enforces its quota.
const nextRequest = new Map();

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const key = process.env.ORS_API_KEY;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const authKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!key || !supabaseUrl || !authKey) return res.status(503).json({ error: "routing_not_configured" });

  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return res.status(401).json({ error: "unauthorized" });

  const points = req.body?.coordinates;
  // Bound requests to Bissau and its immediate surroundings.
  if (!Array.isArray(points) || points.length !== 2 || !points.every(point =>
    Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)
    && point[0] >= -15.85 && point[0] <= -15.3 && point[1] >= 11.65 && point[1] <= 12.05
  )) return res.status(400).json({ error: "invalid_coordinates" });

  try {
    const auth = await fetch(new URL("/auth/v1/user", supabaseUrl), {
      headers: { authorization, apikey: authKey },
      signal: AbortSignal.timeout(3000),
    });
    if (!auth.ok) return res.status(401).json({ error: "unauthorized" });
    const { id } = await auth.json();
    if (!id) return res.status(401).json({ error: "unauthorized" });

    const now = Date.now();
    for (const [user, expires] of nextRequest) {
      if (expires <= now) nextRequest.delete(user);
    }
    if (nextRequest.has(id)) return res.status(429).json({ error: "rate_limited" });
    nextRequest.set(id, now + 8000);

    const response = await fetch("https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson", {
      method: "POST",
      headers: { Authorization: key, "Content-Type": "application/json", Accept: "application/geo+json" },
      body: JSON.stringify({ coordinates: points, instructions: false }),
      signal: AbortSignal.timeout(4500),
    });
    if (!response.ok) return res.status(response.status === 429 ? 429 : 502).json({ error: "route_unavailable" });

    const result = await response.json();
    const feature = result.features?.[0];
    const { distance, duration } = feature?.properties?.summary ?? {};
    const coordinates = feature?.geometry?.coordinates;
    if (feature?.geometry?.type !== "LineString" || !Array.isArray(coordinates) ||
      !Number.isFinite(distance) || distance < 0) {
      return res.status(502).json({ error: "route_unavailable" });
    }
    return res.status(200).json({ coordinates, distance, duration });
  } catch {
    return res.status(502).json({ error: "route_unavailable" });
  }
}
