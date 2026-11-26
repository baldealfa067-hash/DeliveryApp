import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
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
  const origin = from?.map(value => value.toFixed(4)).reverse().join(",") ?? "";
  const destination = to?.map(value => value.toFixed(4)).reverse().join(",") ?? "";
  const latestOrigin = useRef(origin);
  const [sample, setSample] = useState({ origin, destination });
  const routeOrigin = sample.destination === destination ? sample.origin : origin;

  useEffect(() => {
    latestOrigin.current = origin;
    if (!routeOrigin && origin) setSample({ origin, destination });
  }, [origin, routeOrigin, destination]);

  // GPS updates the marker immediately. Requests sample it less frequently
  // so they have time to finish and do not hit the server's 8-second limit.
  useEffect(() => {
    setSample({ origin: latestOrigin.current, destination });
    if (!destination) return;
    const timer = setInterval(() => setSample({ origin: latestOrigin.current, destination }), 15000);
    return () => clearInterval(timer);
  }, [destination]);

  const waypoints = origin && routeOrigin && destination && routeOrigin !== destination
    ? `${routeOrigin};${destination}`
    : "";
  const { data, dataUpdatedAt } = useQuery({
    queryKey: ["delivery-road-route", waypoints],
    enabled: Boolean(waypoints),
    staleTime: 30000,
    retry: false,
    refetchInterval: query => query.state.status === "error" || query.state.data === null ? 15000 : false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(8500)]);
      let coordinates: number[][] | undefined;
      let meters: number | undefined;
      let seconds: number | undefined;
      if (routingBase) {
        const response = await fetch(`${routingBase}/route/v1/driving/${waypoints}?overview=full&geometries=geojson`, { signal: requestSignal });
        if (!response.ok) throw new Error(`Routing failed (${response.status})`);
        const result = await response.json();
        if (result.code !== "Ok") return null;
        const route = result.routes?.[0];
        coordinates = route?.geometry?.coordinates;
        meters = route?.distance;
        seconds = route?.duration;
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return null;
        const response = await fetch("/api/delivery-route", {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ coordinates: waypoints.split(";").map(point => point.split(",").map(Number)) }),
          signal: requestSignal,
        });
        if (!response.ok) throw new Error(`Routing failed (${response.status})`);
        ({ coordinates, distance: meters, duration: seconds } = await response.json());
      }
      if (!Array.isArray(coordinates) || typeof meters !== "number") return null;
      const route = coordinates.map(([lng, lat]) => mapPoint(lat, lng));
      return route.length >= 2 && route.every(Boolean) && Number.isFinite(meters) && meters >= 0
        ? { positions: route as MapPoint[], meters, seconds }
        : null;
    },
  });
  // Keep a recent road route for this same target while the next request
  // runs or recovers from a temporary failure.
  const lastRoad = useRef<{ destination: string; data: NonNullable<typeof data>; updatedAt: number } | null>(null);
  useEffect(() => {
    if (data && waypoints) lastRoad.current = { destination, data, updatedAt: dataUpdatedAt };
  }, [data, dataUpdatedAt, destination, waypoints]);

  const recentRoad = lastRoad.current;
  const road = waypoints ? data ?? (recentRoad?.destination === destination &&
    Date.now() - recentRoad.updatedAt < 45000 ? recentRoad.data : null) : null;
  return {
    positions: road?.positions ?? (waypoints && from && to ? [from, to] : null),
    byRoad: Boolean(road),
    usesOpenRouteService: Boolean(road && !routingBase),
    estimatedMinutes: typeof road?.seconds === "number" && Number.isFinite(road.seconds) && road.seconds >= 0
      ? Math.ceil(road.seconds / 60) : null,
    remainingKm: from && to ? (road?.meters ?? latLng(from).distanceTo(to)) / 1000 : null,
  };
}

export function DeliveryRouteLine({ positions, byRoad }: ReturnType<typeof useDeliveryRoute>) {
  return positions ? (
    <Polyline positions={positions} pathOptions={{ color: "#6646b3", weight: 4, dashArray: byRoad ? undefined : "8 7" }} />
  ) : null;
}

export function DeliveryRouteLegend({ byRoad, usesOpenRouteService }: { byRoad: boolean; usesOpenRouteService?: boolean }) {
  const { t } = useTranslation();
  return (
    <p className="flex items-center gap-2 text-xs text-muted-foreground">
      <span aria-hidden="true" className={`w-6 border-t-2 border-[#6646b3] ${byRoad ? "" : "border-dashed"}`} />
      {t(byRoad ? "orderTracking.map.roadRoute" : "orderTracking.map.directRoute")}
      {usesOpenRouteService && (
        <a href="https://openrouteservice.org/" className="underline" target="_blank" rel="noreferrer">© openrouteservice.org</a>
      )}
    </p>
  );
}
