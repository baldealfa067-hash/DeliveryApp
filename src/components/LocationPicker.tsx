import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Button } from "@/components/ui/button";
import { Loader2, LocateFixed } from "lucide-react";
import { useGeolocation, BISSAU_CENTER, type GeoPosition } from "@/hooks/useGeolocation";

delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

interface LocationPickerProps {
  value: GeoPosition | null;
  onChange: (pos: GeoPosition) => void;
  detectLabel?: string;
  className?: string;
}

function RecenterOnChange({ position }: { position: GeoPosition }) {
  const map = useMap();
  useEffect(() => {
    map.setView([position.lat, position.lng], map.getZoom() < 14 ? 15 : map.getZoom());
  }, [position.lat, position.lng, map]);
  return null;
}

function ClickToPlace({ onChange }: { onChange: (pos: GeoPosition) => void }) {
  useMapEvents({
    click(e) {
      onChange({ lat: e.latlng.lat, lng: e.latlng.lng, accuracy: 0 });
    },
  });
  return null;
}

export function LocationPicker({ value, onChange, detectLabel, className }: LocationPickerProps) {
  const { position, loading, error, detect, setPosition } = useGeolocation();
  const hasAutoDetected = useRef(false);

  useEffect(() => {
    if (!value && !hasAutoDetected.current) {
      hasAutoDetected.current = true;
      detect();
    }
  }, [value, detect]);

  useEffect(() => {
    if (position) onChange(position);
  }, [position]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = value ?? position ?? BISSAU_CENTER;
  const hasRealPosition = Boolean(value ?? position);

  const handleMarkerDrag = (e: L.DragEndEvent) => {
    const latlng = e.target.getLatLng();
    setPosition({ lat: latlng.lat, lng: latlng.lng, accuracy: 0 });
  };

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-2 gap-2">
        <p className="text-sm text-muted-foreground">
          {loading
            ? "A detetar a tua localização..."
            : hasRealPosition
            ? "Localização confirmada — arrasta o pin para ajustar se necessário."
            : "Toca para detetar a tua localização automaticamente."}
        </p>
        <Button type="button" size="sm" variant="outline" onClick={detect} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
          {detectLabel ?? "Detetar"}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive mb-2">{error}</p>}

      <div className="h-64 w-full rounded-lg overflow-hidden border">
        <MapContainer
          center={[current.lat, current.lng]}
          zoom={hasRealPosition ? 15 : 13}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Marker
            position={[current.lat, current.lng]}
            draggable
            eventHandlers={{ dragend: handleMarkerDrag }}
          />
          <ClickToPlace onChange={setPosition} />
          {hasRealPosition && <RecenterOnChange position={current} />}
        </MapContainer>
      </div>
    </div>
  );
}
