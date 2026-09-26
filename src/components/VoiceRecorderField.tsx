import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Mic, Square, Trash2, Loader2, MicOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useVoiceRecorder, formatDuration } from "@/hooks/useVoiceRecorder";
import { useAuth } from "@/hooks/useAuth";
import { BUCKET_PRIVADO, caminhoPrivado, tipoSemParametros, useUrlPrivado } from "@/lib/armazenamentoPrivado";
import { VoicePlayer } from "@/components/VoicePlayer";

/**
 * Campo de gravação de voz, reutilizável.
 *
 * Existe porque a Fase 7.3 precisa de DUAS gravações no mesmo ecrã — a da
 * recolha e a da entrega — e a lógica equivalente vivia inline no
 * `BusinessDetail`, com ~120 linhas entre gravar, reproduzir, enviar e limpar.
 * Copiá-la duas vezes garantia que as três cópias divergiriam.
 *
 * A gravação é enviada para o storage no momento em que o utilizador a termina,
 * não no fim do formulário. É deliberado: numa ligação fraca, enviar três
 * ficheiros no instante em que se carrega em "Confirmar" é o pior momento para
 * descobrir que a rede caiu (§72). Assim, quando o botão é premido só falta um
 * pedido de texto.
 */
const MAX_SEGUNDOS = 30;

export const VoiceRecorderField = ({
  titulo,
  ajuda,
  valor,
  aoMudar,
  pasta,
}: {
  titulo: string;
  ajuda: string;
  valor: string | null;
  aoMudar: (url: string | null) => void;
  pasta: string;
}) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const recorder = useVoiceRecorder();
  const [aEnviar, setAEnviar] = useState(false);
  // Voltou ao ecrã com a gravação já guardada: só há o nome, e o bucket é
  // privado — pede-se um URL assinado. Com a gravação acabada de fazer, toca-se
  // a cópia local, sem ir à rede.
  const { data: urlGuardado } = useUrlPrivado(BUCKET_PRIVADO.notasVoz, recorder.audioUrl ? null : valor);

  // Trava aos 30s. O motorista ouve isto na rua, muitas vezes de capacete —
  // uma indicação longa é uma indicação que não se ouve até ao fim (§51).
  useEffect(() => {
    if (recorder.state === "recording" && recorder.duration >= MAX_SEGUNDOS) {
      recorder.stopRecording();
    }
  }, [recorder.state, recorder.duration, recorder]);

  // Assim que há gravação, envia-se. Ver o comentário no topo.
  useEffect(() => {
    const enviar = async () => {
      if (recorder.state !== "recorded" || !recorder.audioBlob || !user?.id || valor) return;
      const blob = recorder.audioBlob;
      if (blob.size === 0) return;
      setAEnviar(true);
      try {
        const ext = blob.type.includes("mp4") ? "mp4" : "webm";
        // Bucket PRIVADO (ver armazenamentoPrivado.ts). Guarda-se o nome do objecto.
        const nome = caminhoPrivado(user.id, ext, pasta);
        const { error } = await supabase.storage
          .from(BUCKET_PRIVADO.notasVoz)
          .upload(nome, blob, { contentType: tipoSemParametros(blob.type, "audio/webm") });
        if (error) throw error;
        aoMudar(nome);
      } catch {
        // Silencioso de propósito: a voz é um extra, e uma falha aqui não pode
        // impedir o pedido de seguir. O ecrã mostra que não ficou gravada.
        aoMudar(null);
      } finally {
        setAEnviar(false);
      }
    };
    void enviar();
  }, [recorder.state, recorder.audioBlob, user?.id, valor, pasta, aoMudar]);

  const limpar = () => {
    recorder.reset();
    aoMudar(null);
  };

  const temGravacao = recorder.state === "recorded" || !!valor;
  const src = recorder.audioUrl ?? urlGuardado ?? null;
  const progresso = Math.min(100, (recorder.duration / MAX_SEGUNDOS) * 100);

  return (
    <div className="space-y-3 rounded-xl border bg-card p-3">
      <div>
        <p className="text-sm font-semibold">{titulo}</p>
        <p className="text-xs text-muted-foreground">{ajuda}</p>
      </div>

      {recorder.state === "idle" && !valor && (
        <>
          <button
            type="button"
            onClick={() => void recorder.startRecording()}
            className="flex w-full items-center gap-3 rounded-xl border border-dashed border-primary/60 bg-primary-light p-3 text-left transition-colors hover:bg-primary/10 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-card">
              <Mic className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-body font-semibold">{t("voiceRecorder.record")}</span>
              <span className="block text-caption text-muted-foreground">{t("voiceRecorder.maxHint", { seconds: MAX_SEGUNDOS })}</span>
            </span>
          </button>
          {recorder.micError && (
            <p role="alert" className="flex items-start gap-1.5 text-caption text-problem-foreground">
              <MicOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {t("voiceRecorder.micDenied")}
            </p>
          )}
        </>
      )}

      {/* A gravar: tem de ser impossível não perceber. Fundo de marca, círculo a
          pulsar, cronómetro e a barra que enche até ao limite de 30s. */}
      {recorder.state === "recording" && (
        <div className="space-y-2.5 rounded-xl border border-primary bg-primary-light p-3" role="status" aria-live="polite">
          <div className="flex items-center gap-3">
            <span className="relative flex h-12 w-12 shrink-0 items-center justify-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-primary/40" aria-hidden="true" />
              <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Mic className="h-5 w-5" aria-hidden="true" />
              </span>
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t("voiceRecorder.recording")}</p>
              <p className="whitespace-nowrap text-caption tabular-nums text-muted-foreground">
                {formatDuration(recorder.duration)} / {formatDuration(MAX_SEGUNDOS)}
              </p>
            </div>
            <Button type="button" className="h-12 shrink-0 gap-1.5 rounded-full bg-ink px-4 text-ink-foreground hover:bg-ink/90"
              onClick={() => recorder.stopRecording()}>
              <Square className="h-4 w-4" fill="currentColor" aria-hidden="true" />{t("voiceRecorder.stop")}
            </Button>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-primary/20" aria-hidden="true">
            <div className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear" style={{ width: `${progresso}%` }} />
          </div>
        </div>
      )}

      {temGravacao && (
        <div className="space-y-2 rounded-xl border bg-muted/40 p-3">
          <div className="flex items-center gap-2">
            {src ? (
              <VoicePlayer src={src} duracaoConhecida={recorder.state === "recorded" ? recorder.duration : undefined} className="flex-1" />
            ) : (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
            )}
            <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0 text-muted-foreground"
              onClick={limpar} aria-label={t("voiceRecorder.delete")}>
              <Trash2 className="h-5 w-5" />
            </Button>
          </div>
          <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
            {aEnviar && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            {aEnviar ? t("voiceRecorder.saving") : valor ? t("voiceRecorder.saved") : t("voiceRecorder.unsaved")}
          </p>
        </div>
      )}
    </div>
  );
};
