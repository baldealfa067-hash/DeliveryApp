import { useEffect, useRef, useState } from "react";
import { BellRing } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

export function DeliveryArrivalAlert({ orderId, nearby }: { orderId: string; nearby: boolean }) {
  const { t } = useTranslation();
  const audio = useRef<AudioContext | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [played, setPlayed] = useState(false);

  useEffect(() => () => {
    const context = audio.current;
    audio.current = null;
    if (context && context.state !== "closed") void context.close().catch(() => {});
  }, []);

  const enableSound = async () => {
    try {
      const context = audio.current ??= new AudioContext();
      await context.resume();
      if (audio.current !== context) return;
      setEnabled(context.state === "running");
      setUnavailable(context.state !== "running");
    } catch {
      setUnavailable(true);
    }
  };

  useEffect(() => {
    const context = audio.current;
    if (!nearby || !enabled || played || context?.state !== "running") return;
    const storageKey = `itudoo:arrival-sound:${orderId}`;
    try {
      if (sessionStorage.getItem(storageKey)) {
        setPlayed(true);
        return;
      }
    } catch { /* The in-memory guard also works when storage is blocked. */ }

    const start = context.currentTime;
    [523.25, 659.25, 783.99].forEach((frequency, index) => {
      const note = context.createOscillator();
      const gain = context.createGain();
      const time = start + index * 0.17;
      note.frequency.value = frequency;
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.18, time + 0.025);
      gain.gain.linearRampToValueAtTime(0, time + 0.16);
      note.connect(gain).connect(context.destination);
      note.start(time);
      note.stop(time + 0.17);
    });
    setPlayed(true);
    try { sessionStorage.setItem(storageKey, "1"); } catch { /* Optional persistence. */ }
  }, [enabled, nearby, orderId, played]);

  return (
    <div className="space-y-2 border-t px-3 py-3">
      {nearby && (
        <p role="status" className="rounded-lg bg-primary/10 px-3 py-2 text-sm font-semibold">
          {t("orderTracking.arrival.nearby")}
        </p>
      )}
      {!enabled && !unavailable ? (
        <Button type="button" variant="outline" onClick={() => void enableSound()}>
          <BellRing aria-hidden="true" />
          {t("orderTracking.arrival.enable")}
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t(unavailable ? "orderTracking.arrival.unavailable" : "orderTracking.arrival.enabled")}
        </p>
      )}
    </div>
  );
}
