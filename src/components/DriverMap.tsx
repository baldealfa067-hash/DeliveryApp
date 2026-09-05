import { useEffect, useMemo, Component, type ReactNode } from "react";
import { MapContainer, TileLayer, CircleMarker, Marker, Polyline, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BISSAU_CENTER } from "@/hooks/useGeolocation";
import type { AvailableDelivery, Delivery } from "@/hooks/useDrivers";

// Fix Leaflet default icon URLs
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const destinationIcon = L.divIcon({
  className: "",
  html: '<div style="width:20px;height:20px;border-radius:50%;background:#16a34a;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,.3)"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

class MapErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error?: Error }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error) {
    console.error("[DriverMap] map error:", error);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="h-[50vh] w-full rounded-lg border flex flex-col items-center justify-center gap-2 text-muted-foreground p-4">
          <MapPin className="h-8 w-8" />
          <p className="text-sm font-medium">Mapa indisponivel.</p>
          <button onClick={() => this.setState({ hasError: false, error: undefined })} className="text-xs underline mt-1">
            Tentar novamente
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

interface DriverMapProps {
  driverPosition: { lat: number; lng: number } | null;
  availableDeliveries?: AvailableDelivery[];
  activeDelivery?: Delivery | null;
  onAcceptDelivery?: (id: string) => void;
  isAccepting?: boolean;
}

function AutoFitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 15);
      return;
    }
    const bounds = L.latLngBounds(points.map(([lat, lng]) => [lat, lng]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  }, [map, JSON.stringify(points)]);
  return null;
}

export default function DriverMap({
  driverPosition,
  availableDeliveries,
  activeDelivery,
  onAcceptDelivery,
  isAccepting,
}: DriverMapProps) {
  const isRouteMode = !!activeDelivery && ["aceite", "recolhido"].includes(activeDelivery.status);

  // Available deliveries with valid coords
  const mappableDeliveries = useMemo(
    () => (availableDeliveries ?? []).filter((d) => d.restaurant_lat != null && d.restaurant_lng != null),
    [availableDeliveries],
  );

  // Destination for route mode
  const destination = useMemo<[number, number] | null>(() => {
    if (!activeDelivery) return null;
    if (activeDelivery.status === "aceite" && activeDelivery.restaurant_lat != null && activeDelivery.restaurant_lng != null) {
      return [activeDelivery.restaurant_lat, activeDelivery.restaurant_lng];
    }
    if (activeDelivery.status === "recolhido" && activeDelivery.customer_lat != null && activeDelivery.customer_lng != null) {
      return [activeDelivery.customer_lat, activeDelivery.customer_lng];
    }
    return null;
  }, [activeDelivery]);

  // Points for auto-fit
  const fitPoints = useMemo<[number, number][]>(() => {
    const pts: [number, number][] = [];
    if (driverPosition) pts.push([driverPosition.lat, driverPosition.lng]);
    if (isRouteMode && destination) {
      pts.push(destination);
    } else {
      mappableDeliveries.forEach((d) => pts.push([d.restaurant_lat!, d.restaurant_lng!]));
    }
    return pts;
  }, [driverPosition, isRouteMode, destination, mappableDeliveries]);

  const center: [number, number] = driverPosition
    ? [driverPosition.lat, driverPosition.lng]
    : [BISSAU_CENTER.lat, BISSAU_CENTER.lng];

  // Polyline from driver to destination
  const polylinePositions = useMemo<[number, number][] | null>(() => {
    if (!isRouteMode || !driverPosition || !destination) return null;
    return [
      [driverPosition.lat, driverPosition.lng],
      destination,
    ];
  }, [isRouteMode, driverPosition, destination]);

  return (
    <MapErrorBoundary>
      <div className="relative z-0 mb-4">
        <div className="h-[50vh] w-full rounded-lg overflow-hidden border">
          <MapContainer center={center} zoom={14} style={{ height: "100%", width: "100%" }}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            <AutoFitBounds points={fitPoints} />

            {/* Driver position */}
            {driverPosition && (
              <CircleMarker
                center={[driverPosition.lat, driverPosition.lng]}
                radius={8}
                pathOptions={{ color: "#2563eb", fillColor: "#3b82f6", fillOpacity: 1, weight: 3 }}
              />
            )}

            {/* Browse mode: available delivery pins */}
            {!isRouteMode &&
              mappableDeliveries.map((d) => (
                <Marker key={d.id} position={[d.restaurant_lat!, d.restaurant_lng!]}>
                  <Popup>
                    <div className="text-sm min-w-[140px]">
                      <p className="font-bold">{d.restaurant_name}</p>
                      {d.distance_km != null && <p className="text-xs text-gray-500">{d.distance_km.toFixed(1)} km</p>}
                      {onAcceptDelivery && (
                        <button
                          onClick={() => onAcceptDelivery(d.id)}
                          disabled={isAccepting}
                          className="mt-1 w-full text-xs font-medium bg-primary text-primary-foreground px-2 py-1 rounded disabled:opacity-50"
                        >
                          Aceitar
                        </button>
                      )}
                    </div>
                  </Popup>
                </Marker>
              ))}

            {/* Route mode: destination marker */}
            {isRouteMode && destination && <Marker position={destination} icon={destinationIcon} />}

            {/* Route mode: polyline */}
            {polylinePositions && (
              <Polyline positions={polylinePositions} pathOptions={{ color: "#2563eb", weight: 3, dashArray: "8 8" }} />
            )}
          </MapContainer>
        </div>
      </div>
    </MapErrorBoundary>
  );
}
