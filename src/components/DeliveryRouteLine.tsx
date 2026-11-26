import { useQuery } from "@tanstack/react-query";
import { latLng } from "leaflet";
import type { TrackingPoint } from "@/hooks/useDrivers";
import { Polyline } from "react-leaflet";
import { useTranslation } from "react-i18next";

export type MapPoint = [number, number];

export function mapPoint(lat?: number | null, lng?: number | null): MapPoint | null {
  return lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
}

// Ignore stationary jitter and gaps where GPS did not record the trip.
export function distanceRecordedKm(samples: TrackingPoint[]): number | null {
  let previous: { point: MapPoint; time: number } | null = null;
  let segmentCount = 0;
  let meters = 0;
  for (const sample of samples) {
    const point = mapPoint(sample.lat, sample.lng);
    const time = Date.parse(sample.created_at);
    if (!point || !Number.isFinite(time)) continue;
    if (!previous || time - previous.time > 120000) {
      previous = { point, time };
      continue;
    }
    if (time <= previous.time) continue;
    const distance = latLng(previous.point).distanceTo(point);
    const elapsedSeconds = (time - previous.time) / 1000;
    if (distance > Math.max(30, 35 * elapsedSeconds)) continue;
    segmentCount++;
    if (distance < 8) continue;
    meters += distance;
    previous = { point, time };
  }
  return segmentCount ? meters / 1000 : null;
}

const routingBase = import.meta.env.VITE_OSRM_URL?.replace(/\/$/, "");

export function useDeliveryRoute(from: MapPoint | null, to: MapPoint | null) {
  const waypoints = from && to && from.join(",") !== to.join(",")
    ? [from, to].map(([lat, lng]) => `${lng.toFixed(4)},${lat.toFixed(4)}`).join(";")
    : "";
  const { data } = useQuery({
    queryKey: ["delivery-road-route", waypoints],
    enabled: Boolean(routingBase && waypoints),
    staleTime: 30000,
    retry: false,
    queryFn: async ({ signal }) => {
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(6000)]);
      const response = await fetch(`${routingBase}/route/v1/driving/${waypoints}?overview=full&geometries=geojson`, { signal: requestSignal });
      if (!response.ok) throw new Error("Routing request failed");
      const result = await response.json();
      if (result.code !== "Ok" || !Array.isArray(result.routes?.[0]?.geometry?.coordinates)) return null;
      const route = result.routes[0].geometry.coordinates.map(([lng, lat]: number[]) => mapPoint(lat, lng));
      const meters = result.routes[0].distance;
      return route.length >= 2 && route.every(Boolean) && Number.isFinite(meters) && meters >= 0
        ? { positions: route as MapPoint[], meters, seconds: result.routes[0].duration }
        : null;
    },
  });
  return {
    positions: data?.positions ?? (waypoints && from && to ? [from, to] : null),
    byRoad: Boolean(data),
    estimatedMinutes: typeof data?.seconds === "number" && Number.isFinite(data.seconds) && data.seconds >= 0
      ? Math.ceil(data.seconds / 60) : null,
    remainingKm: from && to ? (data?.meters ?? latLng(from).distanceTo(to)) / 1000 : null,
  };
}

export function DeliveryRouteLine({ positions, byRoad }: ReturnType<typeof useDeliveryRoute>) {
  return positions ? (
    <Polyline positions={positions} pathOptions={{ color: "#6646b3", weight: 4, dashArray: byRoad ? undefined : "8 7" }} />
  ) : null;
}

export function DeliveryRouteLegend({ byRoad }: { byRoad: boolean }) {
  const { t } = useTranslation();
  return (
    <p className="flex items-center gap-2 text-xs text-muted-foreground">
      <span aria-hidden="true" className={`w-6 border-t-2 border-[#6646b3] ${byRoad ? "" : "border-dashed"}`} />
      {t(byRoad ? "orderTracking.map.roadRoute" : "orderTracking.map.directRoute")}
    </p>
  );
}
