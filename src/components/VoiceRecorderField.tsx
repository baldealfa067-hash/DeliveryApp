import { useEffect, useRef, useState } from "react";
import { Mic, Pause, Play, Square, Trash2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useVoiceRecorder, formatDuration } from "@/hooks/useVoiceRecorder";
import { useAuth } from "@/hooks/useAuth";

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
  const { user } = useAuth();
  const recorder = useVoiceRecorder();
  const [aEnviar, setAEnviar] = useState(false);
  const [aTocar, setATocar] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
        const nome = `${user.id}/${pasta}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage
          .from("portfolio")
          .upload(nome, blob, { contentType: blob.type || "audio/webm" });
        if (error) throw error;
        const { data } = supabase.storage.from("portfolio").getPublicUrl(nome);
        aoMudar(data.publicUrl);
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

  const alternarLeitura = () => {
    const src = recorder.audioUrl ?? valor;
    if (!src) return;
    if (!audioRef.current) {
      audioRef.current = new Audio(src);
      audioRef.current.onended = () => setATocar(false);
    }
    if (aTocar) { audioRef.current.pause(); setATocar(false); }
    else { void audioRef.current.play(); setATocar(true); }
  };

  const limpar = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setATocar(false);
    recorder.reset();
    aoMudar(null);
  };

  const temGravacao = recorder.state === "recorded" || !!valor;

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div>
        <p className="text-sm font-medium">{titulo}</p>
        <p className="text-xs text-muted-foreground">{ajuda}</p>
      </div>

      {recorder.state === "idle" && !valor && (
        <Button type="button" variant="outline" className="w-full h-12"
          onClick={() => void recorder.startRecording()}>
          <Mic className="h-4 w-4 mr-2" />Gravar indicação
        </Button>
      )}

      {recorder.state === "recording" && (
        <div className="flex items-center gap-2">
          <span className="flex-1 text-sm tabular-nums">
            <span className="inline-block h-2 w-2 rounded-full bg-destructive animate-pulse mr-2" />
            {formatDuration(recorder.duration)} / {formatDuration(MAX_SEGUNDOS)}
          </span>
          <Button type="button" variant="destructive" className="h-11"
            onClick={() => recorder.stopRecording()}>
            <Square className="h-4 w-4 mr-2" />Parar
          </Button>
        </div>
      )}

      {temGravacao && (
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="icon" className="h-11 w-11"
            onClick={alternarLeitura} disabled={aEnviar}>
            {aTocar ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <span className="flex-1 text-sm text-muted-foreground">
            {aEnviar ? "A guardar…" : valor ? "Gravada" : "Gravada (por guardar)"}
          </span>
          {aEnviar && <Loader2 className="h-4 w-4 animate-spin" />}
          <Button type="button" variant="ghost" size="icon" className="h-11 w-11" onClick={limpar}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
};
