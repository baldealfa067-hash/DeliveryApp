import { divIcon } from "leaflet";
import { Marker, Tooltip } from "react-leaflet";
import type { MapPoint } from "./DeliveryRouteLine";

export type MapMarkerKind = "driver" | "restaurant" | "pickup" | "customer";

const symbols: Record<MapMarkerKind, string> = {
  driver: '<circle cx="5" cy="17" r="3"/><circle cx="19" cy="17" r="3"/><path d="m19 17-3-10h-4m-7 10 3-5h9m-9 0V9H5m4 8h5"/>',
  restaurant: '<path d="M3 17h18M5 14a7 7 0 0 1 14 0M12 7V5m-2 0h4"/>',
  pickup: '<path d="m3 7 9-4 9 4v10l-9 4-9-4Zm0 0 9 4 9-4m-9 4v10"/>',
  customer: '<circle cx="12" cy="7" r="3"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
};

export function DeliveryMapMarker({ point, label, color, kind }: {
  point: MapPoint; label: string; color: string; kind: MapMarkerKind;
}) {
  const icon = divIcon({
    className: "",
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    html: `<span style="display:grid;place-items:center;width:36px;height:36px;border-radius:50%;border:2px solid white;background:${color};color:white;box-shadow:0 2px 6px #0005"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${symbols[kind]}</svg></span>`,
  });
  return (
    <Marker position={point} icon={icon} alt={label} title={label} zIndexOffset={kind === "driver" ? 500 : 0}>
      <Tooltip>{label}</Tooltip>
    </Marker>
  );
}
