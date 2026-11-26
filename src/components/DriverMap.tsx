import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useTranslation } from "react-i18next";
import { useDeliveryTracking, type Delivery } from "@/hooks/useDrivers";
import { distanceRecordedKm, DeliveryRouteLegend, DeliveryRouteLine, mapPoint, useDeliveryRoute, type MapPoint } from "./DeliveryRouteLine";

import { DeliveryMapMarker, type MapMarkerKind } from "./DeliveryMapMarker";

function FitPoints({ points, phase }: { points: MapPoint[]; phase: string }) {
  const map = useMap();
  const lastFit = useRef("");
  useEffect(() => {
    const fitKey = `${phase}:${points.length}`;
    if (!points.length || lastFit.current === fitKey) return;
    lastFit.current = fitKey;
    map.fitBounds(points, { padding: [44, 44], maxZoom: 16 });
  }, [map, points, phase]);
  return null;
}

export default function DriverMap({ driverPosition, activeDelivery }: {
  driverPosition: { lat: number; lng: number } | null;
  activeDelivery: Delivery;
}) {
  const { t, i18n } = useTranslation();
  const { data: tracking } = useDeliveryTracking(activeDelivery.id);
  const recordedKm = distanceRecordedKm(tracking ?? []);
  const formatKm = (distance: number | null) => distance === null ? "—" :
    new Intl.NumberFormat(i18n.language, { style: "unit", unit: "kilometer", maximumFractionDigits: 2 }).format(distance);
  const driver = mapPoint(driverPosition?.lat, driverPosition?.lng);
  const pickup = mapPoint(activeDelivery.restaurant_lat, activeDelivery.restaurant_lng);
  const customer = mapPoint(activeDelivery.customer_lat, activeDelivery.customer_lng);
  const target = activeDelivery.status === "aceite" ? pickup : customer;
  const route = useDeliveryRoute(driver, target);
  const markers: { point: MapPoint | null; label: string; color: string; kind: MapMarkerKind }[] = [
    { point: driver, label: t("orderTracking.map.driver"), color: "#c64d00", kind: "driver" },
    { point: pickup, label: activeDelivery.restaurant_name || t("orderTracking.map.pickup"), color: "#334155", kind: activeDelivery.order_total == null || !activeDelivery.items?.length ? "pickup" : "restaurant" },
    { point: customer, label: t("orderTracking.map.customer"), color: "#225d47", kind: "customer" },
  ];
  const points = markers.flatMap(({ point }) => point ? [point] : []);

  return (
    <section aria-label={t("orderTracking.map.title")} className="isolate mb-4 overflow-hidden rounded-xl border bg-card">
      {points.length > 0 && (
        <MapContainer center={points[0]} zoom={14}
          scrollWheelZoom={false} className="h-64 w-full bg-muted sm:h-80">
          <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
          <FitPoints points={points} phase={activeDelivery.status} />
          <DeliveryRouteLine {...route} />
          {markers.map(({ point, label, color, kind }) => point && (
            <DeliveryMapMarker key={kind} point={point} label={label} color={color} kind={kind} />
          ))}
        </MapContainer>
      )}
      <div className="space-y-2 px-3 py-2">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {markers.map(({ point, label, color }) => (
            <li key={label} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: point ? color : "#64748b" }} aria-hidden="true" />
              {label}{!point && ` · ${t("orderTracking.map.noPoint")}`}
            </li>
          ))}
        </ul>
        {route.positions && <DeliveryRouteLegend byRoad={route.byRoad} usesOpenRouteService={route.usesOpenRouteService} />}
        <dl className="grid grid-cols-2 gap-2 border-t pt-2">
          <div className="rounded-lg bg-muted px-3 py-2">
            <dt className="text-xs text-muted-foreground">{t(route.byRoad
              ? "orderTracking.map.remainingRoad" : "orderTracking.map.remainingDirect")}</dt>
            <dd className="text-lg font-bold tabular-nums">{formatKm(route.remainingKm)}</dd>
          </div>
          <div className="rounded-lg bg-muted px-3 py-2">
            <dt className="text-xs text-muted-foreground">{t("orderTracking.map.recordedDistance")}</dt>
            <dd className="text-lg font-bold tabular-nums">{formatKm(recordedKm)}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
