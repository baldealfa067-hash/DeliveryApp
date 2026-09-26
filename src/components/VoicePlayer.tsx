import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/hooks/useVoiceRecorder";

/**
 * Leitor de uma indicação de voz: UM botão — toca para ouvir, toca outra vez
 * para pausar (2026-09-25).
 *
 * Substitui o `<audio controls>` nativo. Num telemóvel estreito o Chrome encolhe
 * esses controlos e esconde o "play" atrás de um menu de três pontos: o motorista,
 * na rua e muitas vezes com uma mão, tinha de abrir um menu para ouvir por onde
 * ir (§51). Aqui o botão é grande (48px) e está sempre à vista.
 *
 * `src` pode mudar enquanto o componente vive (o URL assinado de um bucket
 * privado renova-se de 4 em 4 minutos). Só se troca quando NÃO está a tocar —
 * trocar a meio cortava a indicação.
 */
export const VoicePlayer = ({
  src,
  duracaoConhecida,
  className,
}: {
  src: string;
  /** Segundos, quando se sabe (a gravação acabada de fazer). O WebM do
   *  MediaRecorder costuma chegar com duração `Infinity`, e sem isto a barra
   *  não teria fim. */
  duracaoConhecida?: number;
  className?: string;
}) => {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [aTocar, setATocar] = useState(false);
  const [atual, setAtual] = useState(0);
  const [duracao, setDuracao] = useState<number | null>(duracaoConhecida ?? null);
  const [falhou, setFalhou] = useState(false);
  // Entre o toque e o primeiro som vai-se buscar o ficheiro ao Storage — com
  // rede fraca, segundos. Sem sinal, um botão em "pausa" calado parece avaria.
  const [aCarregar, setACarregar] = useState(false);

  useEffect(() => {
    if (duracaoConhecida) setDuracao(duracaoConhecida);
  }, [duracaoConhecida]);

  // URL novo: fica para o próximo toque, a não ser que esteja a tocar.
  useEffect(() => {
    if (audioRef.current && audioRef.current.paused) {
      audioRef.current.src = src;
      setFalhou(false);
    }
  }, [src]);

  // Parar ao sair do ecrã, senão a voz continuava a tocar noutro sítio.
  useEffect(() => () => audioRef.current?.pause(), []);

  const obterAudio = () => {
    if (audioRef.current) return audioRef.current;
    const a = new Audio(src);
    a.preload = "metadata";
    a.onloadedmetadata = () => {
      if (Number.isFinite(a.duration) && a.duration > 0) setDuracao(a.duration);
    };
    a.ontimeupdate = () => setAtual(a.currentTime);
    a.onended = () => {
      setATocar(false);
      setAtual(0);
    };
    a.onpause = () => {
      setATocar(false);
      setACarregar(false);
    };
    a.onplay = () => setATocar(true);
    a.onwaiting = () => setACarregar(true);
    a.onplaying = () => setACarregar(false);
    a.onerror = () => {
      setATocar(false);
      setACarregar(false);
      setFalhou(true);
    };
    audioRef.current = a;
    return a;
  };

  const alternar = () => {
    const a = obterAudio();
    if (aTocar) {
      a.pause();
      return;
    }
    setFalhou(false);
    if (a.readyState < 3) setACarregar(true);
    a.play().catch(() => {
      setACarregar(false);
      setFalhou(true);
    });
  };

  const fim = duracao && duracao > 0 ? duracao : null;
  const pct = fim ? Math.min(100, (atual / fim) * 100) : 0;

  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <button
        type="button"
        onClick={alternar}
        aria-label={aTocar ? t("voicePlayer.pause") : t("voicePlayer.play")}
        aria-pressed={aTocar}
        aria-busy={aCarregar}
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-card transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {aCarregar ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : aTocar ? (
          <Pause className="h-5 w-5" fill="currentColor" />
        ) : (
          <Play className="ml-0.5 h-5 w-5" fill="currentColor" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-caption tabular-nums text-muted-foreground">
          {falhou
            ? t("common.mediaUnavailable")
            : `${formatDuration(Math.floor(atual))}${fim ? ` / ${formatDuration(Math.round(fim))}` : ""}`}
        </p>
      </div>
    </div>
  );
};
