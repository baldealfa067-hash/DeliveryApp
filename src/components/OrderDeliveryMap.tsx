import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from "react-leaflet";
import { LocateFixed, MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { BISSAU_CENTER } from "@/hooks/useGeolocation";
import { Button } from "@/components/ui/button";
import "leaflet/dist/leaflet.css";
import { DeliveryRouteLegend, DeliveryRouteLine, mapPoint, useDeliveryRoute } from "./DeliveryRouteLine";

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
      className="absolute right-3 top-3 z-[450] rounded-full bg-card shadow-card"
      onClick={() => fit(map, points)}>
      <LocateFixed aria-hidden="true" />
    </Button>
  );
}

export default function OrderDeliveryMap({ orderId, toCustomer, isShipment }: { orderId: string; toCustomer: boolean; isShipment: boolean }) {
  const { t } = useTranslation();
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
          <MapContainer center={points[0].coords} zoom={15} scrollWheelZoom={false} className="h-60 w-full bg-muted sm:h-72">
            <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
            <Recenter points={points} label={t("orderTracking.map.recenter")} />
            <DeliveryRouteLine {...route} />
            {points.map(point => (
              <CircleMarker key={point.id} center={point.coords} radius={point.id === "driver" ? 10 : 7}
                pathOptions={{ color: "white", weight: 3, fillColor: point.color, fillOpacity: 1 }}>
                <Tooltip permanent direction={point.id === "driver" ? "bottom" : point.id === "pickup" ? "right" : "left"}>{point.label}</Tooltip>
              </CircleMarker>
            ))}
          </MapContainer>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 text-xs">
            {points.map(point => (
              <li key={point.id} className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: point.color }} aria-hidden="true" />
                {point.label}
              </li>
            ))}
          </ul>
          {route.positions && <div className="px-3 pb-2"><DeliveryRouteLegend byRoad={route.byRoad} /></div>}
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
