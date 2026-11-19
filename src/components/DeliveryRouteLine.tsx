import { useQuery } from "@tanstack/react-query";
import { Polyline } from "react-leaflet";
import { useTranslation } from "react-i18next";

export type MapPoint = [number, number];

export function mapPoint(lat?: number | null, lng?: number | null): MapPoint | null {
  return lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
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
      return route.length >= 2 && route.every(Boolean) ? route as MapPoint[] : null;
    },
  });
  return { positions: data ?? (waypoints && from && to ? [from, to] : null), byRoad: Boolean(data) };
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
