import { useEffect } from "react";
import { CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { BISSAU_CENTER, type GeoPosition } from "@/hooks/useGeolocation";
import "leaflet/dist/leaflet.css";

type SelectionProps = {
  position: GeoPosition | null;
  onSelect: (position: GeoPosition) => void;
};

function LocationSelection({ position, onSelect }: SelectionProps) {
  const map = useMap();
  useMapEvents({
    click: ({ latlng }) => {
      const { lat, lng } = latlng.wrap();
      onSelect({ lat, lng, accuracy: 0 });
    },
  });
  useEffect(() => {
    if (position && position.accuracy > 0) {
      map.setView([position.lat, position.lng], Math.max(map.getZoom(), 15));
    }
  }, [map, position]);

  return position ? (
    <CircleMarker center={[position.lat, position.lng]} radius={9}
      pathOptions={{ color: "white", weight: 3, fillColor: "#e66500", fillOpacity: 1 }} interactive={false} />
  ) : null;
}

export default function DeliveryLocationMap(props: SelectionProps) {
  const center = props.position ?? BISSAU_CENTER;
  return (
    <MapContainer center={[center.lat, center.lng]} zoom={14} scrollWheelZoom={false}
      className="h-56 w-full rounded-lg border bg-muted">
      <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
      <LocationSelection {...props} />
    </MapContainer>
  );
}
