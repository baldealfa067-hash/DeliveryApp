import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import { LocateFixed, MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { BISSAU_CENTER } from "@/hooks/useGeolocation";
import { Button } from "@/components/ui/button";
import "leaflet/dist/leaflet.css";
import { DeliveryRouteLegend, DeliveryRouteLine, mapPoint, useDeliveryRoute } from "./DeliveryRouteLine";

import { DeliveryMapMarker } from "./DeliveryMapMarker";

type Point = { id: string; label: string; coords: [number, number]; color: string };

function fit(map: ReturnType<typeof useMap>, points: Point[]) {
  if (points.length > 1) {
    map.fitBounds(points.map(({ coords }) => coords), { padding: [36, 36], maxZoom: 16 });
  } else {
    map.setView(points[0]?.coords ?? [BISSAU_CENTER.lat, BISSAU_CENTER.lng], points.length ? 15 : 13);
  }
}

function Recenter({ points, label }: { points: Point[]; label: string }) {
  const map = useMap();
  // Fit once without resetting the customer's pan on every GPS update.
  useEffect(() => {
    fit(map, points);
    // The initial points are loaded before the map mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);
  return (
    <Button type="button" size="icon" variant="outline" aria-label={label}
      className="absolute right-3 top-14 z-[450] rounded-full bg-card shadow-card"
      onClick={() => fit(map, points)}>
      <LocateFixed aria-hidden="true" />
    </Button>
  );
}

export default function OrderDeliveryMap({ orderId, toCustomer, isShipment, statusLabel }: { orderId: string; toCustomer: boolean; isShipment: boolean; statusLabel: string }) {
  const { t, i18n } = useTranslation();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["customer-delivery-map", orderId],
    queryFn: async () => {
      const { data: row, error } = await supabase.rpc("get_customer_delivery_map", { p_order_id: orderId }).maybeSingle();
      if (error) throw error;
      return row;
    },
    refetchInterval: 15000,
    retry: false,
  });
  const points: Point[] = [];
  const add = (id: string, lat: number | null | undefined, lng: number | null | undefined, color: string) => {
    if (lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      points.push({ id, coords: [lat, lng], label: t(`orderTracking.map.${id === "pickup" && !isShipment ? "restaurant" : id === "destination" ? "customer" : id}`), color });
    }
  };
  add("pickup", data?.pickup_lat, data?.pickup_lng, "#334155");
  add("destination", data?.destination_lat, data?.destination_lng, "#225d47");
  if (!isError) add("driver", data?.driver_lat, data?.driver_lng, "#c64d00");

  const currentDriver = points.find(point => point.id === "driver")?.coords ?? null;
  const target = toCustomer
    ? mapPoint(data?.destination_lat, data?.destination_lng)
    : mapPoint(data?.pickup_lat, data?.pickup_lng);
  const route = useDeliveryRoute(currentDriver, target);

  return (
    <section aria-label={t("orderTracking.map.title")} className="isolate overflow-hidden rounded-2xl border bg-card">
      {points.length > 0 ? (
        <>
          <div className="relative">
            <MapContainer center={points[0].coords} zoom={15} scrollWheelZoom={false} className="h-72 w-full bg-muted sm:h-80">
              <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
              <Recenter points={points} label={t("orderTracking.map.recenter")} />
              <DeliveryRouteLine {...route} />
              {points.map(point => (
                <DeliveryMapMarker key={point.id} point={point.coords} label={point.label} color={point.color}
                  kind={point.id === "driver" ? "driver" : point.id === "destination" ? "customer" : isShipment ? "pickup" : "restaurant"} />
              ))}
            </MapContainer>
            <div className="pointer-events-none absolute inset-x-12 top-3 z-[450] flex justify-center">
              <span className="inline-flex min-w-0 items-center gap-2 rounded-full bg-card px-3 py-2 text-xs font-semibold shadow-card">
                {currentDriver && <span className="inline-flex shrink-0 items-center gap-1 text-primary">
                  <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
                  {t("orderTracking.map.livePosition")}
                </span>}
                <span className="truncate">{statusLabel}</span>
              </span>
            </div>
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 text-xs">
            {points.map(point => (
              <li key={point.id} className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: point.color }} aria-hidden="true" />
                {point.label}
              </li>
            ))}
          </ul>
          {route.positions && <div className="px-3 pb-2"><DeliveryRouteLegend byRoad={route.byRoad} /></div>}
          {route.remainingKm !== null && (
            <dl className="mx-3 mb-3 grid auto-cols-fr grid-flow-col divide-x rounded-xl bg-primary/10 py-2 text-center">
              <div className="px-2">
                <dt className="text-xs text-muted-foreground">{t(route.byRoad ? "orderTracking.map.remainingRoad" : "orderTracking.map.remainingDirect")}</dt>
                <dd className="font-bold tabular-nums">{new Intl.NumberFormat(i18n.language, {
                  style: "unit", unit: "kilometer", maximumFractionDigits: 2,
                }).format(route.remainingKm)}</dd>
              </div>
              {route.estimatedMinutes !== null && (
                <div className="px-2">
                  <dt className="text-xs text-muted-foreground">{t("orderTracking.map.nextStopEstimate")}</dt>
                  <dd className="font-bold tabular-nums">{new Intl.NumberFormat(i18n.language, {
                    style: "unit", unit: "minute",
                  }).format(route.estimatedMinutes)}</dd>
                </div>
              )}
            </dl>
          )}
        </>
      ) : (
        <p className="flex min-h-24 items-center gap-3 px-4 py-3 text-sm text-muted-foreground">
          <MapPin className="size-5 shrink-0 text-primary" aria-hidden="true" />
          {t(isLoading ? "common.loading" : isError ? "orderTracking.map.unavailable" : "orderTracking.map.noLocation")}
        </p>
      )}
    </section>
  );
}
