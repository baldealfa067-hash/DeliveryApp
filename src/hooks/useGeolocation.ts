import { useCallback, useState } from "react";

export interface GeoPosition {
  lat: number;
  lng: number;
  accuracy: number;
}

interface UseGeolocationResult {
  position: GeoPosition | null;
  loading: boolean;
  error: string | null;
  detect: () => void;
  setPosition: (pos: GeoPosition) => void;
}

export const BISSAU_CENTER: GeoPosition = { lat: 11.8636, lng: -15.5977, accuracy: 0 };

export function useGeolocation(): UseGeolocationResult {
  const [position, setPosition] = useState<GeoPosition | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detect = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setError("O teu dispositivo não suporta deteção automática de localização.");
      return;
    }
    setLoading(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        if (err.code === err.PERMISSION_DENIED) {
          setError("Permissão de localização negada. Podes marcar manualmente no mapa.");
        } else {
          setError("Não foi possível obter a localização. Tenta marcar manualmente no mapa.");
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, []);

  return { position, loading, error, detect, setPosition };
}
