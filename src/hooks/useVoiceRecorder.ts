import { useState, useRef, useCallback } from "react";

type RecorderState = "idle" | "recording" | "recorded";

export function useVoiceRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const [duration, setDuration] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
  }, [audioUrl]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 1,
        },
      });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/mp4";

      const mr = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 64000,
      });
      mediaRecorderRef.current = mr;
      chunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType });
        const url = URL.createObjectURL(blob);
        setAudioBlob(blob);
        setAudioUrl(url);
        setState("recorded");
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };

      mr.start();
      setState("recording");
      setDuration(0);
      setAudioBlob(null);
      setAudioUrl(null);

      timerRef.current = setInterval(() => {
        setDuration((d) => d + 1);
      }, 1000);
    } catch {
      setState("idle");
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
    }
    cleanup();
    chunksRef.current = [];
    setAudioBlob(null);
    setAudioUrl(null);
    setDuration(0);
    setState("idle");
  }, [cleanup]);

  const reset = useCallback(() => {
    cleanup();
    chunksRef.current = [];
    setAudioBlob(null);
    setAudioUrl(null);
    setDuration(0);
    setState("idle");
  }, [cleanup]);

  return {
    state,
    duration,
    audioBlob,
    audioUrl,
    startRecording,
    stopRecording,
    cancelRecording,
    reset,
  };
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
