import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Send,
  MessageSquare,
  Phone,
  ArrowLeft,
  Check,
  CheckCheck,
  Mic,
  Square,
  X,
  Play,
  Pause,
  Loader2,
  Image as ImageIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/useAuth";
import {
  useMessages,
  useSendMessage,
  useMarkMessagesAsRead,
  useMessagesRealtime,
} from "@/hooks/useChat";
import { useVoiceRecorder, formatDuration } from "@/hooks/useVoiceRecorder";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Message } from "@/hooks/useChat";

const VoiceMessagePlayer = ({ url, isMine }: { url: string; isMine: boolean }) => {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.addEventListener("timeupdate", () => {
      if (audio.duration) setProgress((audio.currentTime / audio.duration) * 100);
    });
    audio.addEventListener("ended", () => {
      setPlaying(false);
      setProgress(0);
    });
    return () => {
      audio.pause();
      audio.src = "";
    };
  }, [url]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.play();
      setPlaying(true);
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 180 }}>
      <button
        onClick={toggle}
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          border: "none",
          background: isMine ? "hsl(var(--primary-foreground) / 0.2)" : "hsl(var(--primary) / 0.15)",
          color: "inherit",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        {playing ? <Pause style={{ width: 14, height: 14 }} /> : <Play style={{ width: 14, height: 14, marginLeft: 2 }} />}
      </button>
      <div style={{ flex: 1, height: 4, borderRadius: 2, background: isMine ? "hsl(var(--primary-foreground) / 0.2)" : "hsl(var(--muted))", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${progress}%`, borderRadius: 2, background: isMine ? "hsl(var(--primary-foreground) / 0.7)" : "hsl(var(--primary))", transition: "width 0.1s" }} />
      </div>
    </div>
  );
};

const ChatPage = () => {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();

  const myId = user?.id ?? "";

  const [otherUserName, setOtherUserName] = useState("");
  const [otherUserPhone, setOtherUserPhone] = useState("");
  const [otherUserPhoto, setOtherUserPhoto] = useState<string | null>(null);

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: messages = [], isLoading, isError } = useMessages(myId || null, userId ?? null);
  const sendMessage = useSendMessage();
  const markAsRead = useMarkMessagesAsRead();
  const recorder = useVoiceRecorder();
  const [uploading, setUploading] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useMessagesRealtime(user?.id ?? null, userId ?? null);

  useEffect(() => {
    if (!userId) return;
    supabase
      .from("profiles")
      .select("name, phone, photo_url")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setOtherUserName(data.name ?? "");
          setOtherUserPhone(data.phone ?? "");
          setOtherUserPhoto(data.photo_url ?? null);
        }
      });
  }, [userId]);

  useEffect(() => {
    if (!authLoading && !user) {
      toast.error(t("chat.loginRequired"));
      navigate("/login", { replace: true });
    }
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (user?.id && userId) {
      markAsRead.mutate({ userId: user.id, otherUserId: userId });
    }
  }, [user?.id, userId]);

  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 200);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;
    if (!userId) {
      toast.error(t("chat.errorNoRecipient"));
      return;
    }
    if (!user?.id) {
      toast.error(t("chat.loginRequired"));
      navigate("/login", { replace: true });
      return;
    }
    const content = input.trim();
    setInput("");
    try {
      await sendMessage.mutateAsync({
        senderId: user.id,
        receiverId: userId,
        content,
      });
    } catch (err) {
      console.error("[chat] send error:", err);
      toast.error(t("chat.sendError"));
      setInput(content);
    }
  };

  const handleSendVoice = async () => {
    if (!recorder.audioBlob || !userId || !user?.id) return;
    setUploading(true);
    try {
      const blob = recorder.audioBlob;
      if (blob.size === 0) {
        toast.error(t("chat.sendError"));
        setUploading(false);
        return;
      }
      const ext = blob.type.includes("webm") ? "webm" : blob.type.includes("mp4") ? "mp4" : "webm";
      const fileName = `${user.id}/chat/voice/${Date.now()}-${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("portfolio")
        .upload(fileName, blob, { contentType: blob.type || "audio/webm" });
      if (uploadError) {
        console.error("[chat] voice upload error:", uploadError);
        throw uploadError;
      }

      const { data: urlData } = supabase.storage.from("portfolio").getPublicUrl(fileName);
      await sendMessage.mutateAsync({
        senderId: user.id,
        receiverId: userId,
        content: urlData.publicUrl,
        messageType: "voice",
        imageUrl: urlData.publicUrl,
      });
      recorder.reset();
    } catch (err) {
      console.error("[chat] voice send error:", err);
      toast.error(t("chat.sendError"));
    } finally {
      setUploading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMAGE_SIZE) {
      toast.error(t("common.imageTooLarge"));
      return;
    }
    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSendImage = async () => {
    if (!selectedFile || !userId || !user?.id) return;
    setUploading(true);
    try {
      const fileName = `${user.id}/chat/images/${Date.now()}-${crypto.randomUUID()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from("portfolio")
        .upload(fileName, selectedFile, { contentType: selectedFile.type });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("portfolio").getPublicUrl(fileName);
      await sendMessage.mutateAsync({
        senderId: user.id,
        receiverId: userId,
        content: urlData.publicUrl,
        messageType: "image",
        imageUrl: urlData.publicUrl,
      });
      setImagePreview(null);
      setSelectedFile(null);
    } catch (err) {
      console.error("[chat] image send error:", err);
      toast.error(t("chat.sendError"));
    } finally {
      setUploading(false);
    }
  };

  const groupedMessages: { date: string; messages: Message[] }[] = [];
  let currentDate = "";
  for (const msg of messages) {
    const msgDate = new Date(msg.created_at).toLocaleDateString();
    if (msgDate !== currentDate) {
      currentDate = msgDate;
      groupedMessages.push({ date: msgDate, messages: [] });
    }
    groupedMessages[groupedMessages.length - 1].messages.push(msg);
  }

  if (authLoading) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--background)" }}>
        <p style={{ fontSize: 14, color: "var(--muted-foreground)" }}>{t("common.loading")}</p>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", flexDirection: "column", background: "var(--background)" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--border)", background: "var(--card)", flexShrink: 0 }}>
        <Button
          variant="ghost"
          size="icon"
          style={{ width: 36, height: 36, flexShrink: 0 }}
          onClick={() => navigate(-1)}
        >
          <ArrowLeft style={{ width: 20, height: 20 }} />
        </Button>
        <Avatar style={{ width: 36, height: 36, flexShrink: 0 }}>
          {otherUserPhoto ? (
            <AvatarImage src={otherUserPhoto} alt={otherUserName} className="object-cover" />
          ) : null}
          <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
            {otherUserName.charAt(0) || "?"}
          </AvatarFallback>
        </Avatar>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{otherUserName || userId}</h2>
        </div>
        {otherUserPhone && (
          <a href={`tel:${otherUserPhone.replace(/\s/g, "")}`}>
            <Button variant="ghost" size="icon" style={{ width: 36, height: 36 }}>
              <Phone style={{ width: 20, height: 20 }} />
            </Button>
          </a>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 8px 16px" }}>
        {!userId && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", textAlign: "center", color: "var(--muted-foreground)" }}>
            <p style={{ fontSize: 14 }}>{t("chat.errorNoRecipient")}</p>
          </div>
        )}

        {userId && isLoading && messages.length === 0 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--muted-foreground)" }}>
            <p style={{ fontSize: 14 }}>{t("common.loading")}</p>
          </div>
        )}

        {userId && isError && !isLoading && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", textAlign: "center", color: "var(--muted-foreground)" }}>
            <p style={{ fontSize: 14, fontWeight: 500 }}>{t("chat.loadError")}</p>
            <p style={{ fontSize: 12, marginTop: 4 }}>{t("chat.loadErrorHint")}</p>
          </div>
        )}

        {userId && !isLoading && !isError && messages.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", textAlign: "center", color: "var(--muted-foreground)" }}>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: "hsl(var(--primary) / 0.1)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
              <MessageSquare style={{ width: 32, height: 32, opacity: 0.5 }} />
            </div>
            <p style={{ fontSize: 14, fontWeight: 500 }}>{t("chat.startConversation")}</p>
            <p style={{ fontSize: 12, marginTop: 4, maxWidth: 250 }}>{t("chat.startConversationHint")}</p>
          </div>
        )}

        {groupedMessages.map((group) => (
          <div key={group.date}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", margin: "12px 0" }}>
              <span style={{ fontSize: 11, color: "var(--muted-foreground)", background: "var(--background)", padding: "4px 12px", borderRadius: 9999, border: "1px solid var(--border)" }}>
                {group.date}
              </span>
            </div>

            {group.messages.map((msg, idx) => {
              const isMine = msg.sender_id === myId;
              const nextMsg = group.messages[idx + 1];
              const isLastInGroup = !nextMsg || nextMsg.sender_id !== msg.sender_id;
              const showTime =
                isLastInGroup ||
                (nextMsg &&
                  new Date(nextMsg.created_at).getTime() - new Date(msg.created_at).getTime() > 5 * 60 * 1000);

              const isVoice = msg.message_type === "voice";
              const isImage = msg.message_type === "image" ||
                msg.content.match(/\.(jpg|jpeg|png|gif|webp)/i) ||
                (msg.image_url && msg.image_url.length > 0);

              return (
                <div
                  key={msg.id}
                  style={{
                    display: "flex",
                    justifyContent: isMine ? "flex-end" : "flex-start",
                    marginBottom: isLastInGroup ? 12 : 2,
                  }}
                >
                  <div
                    style={{
                      maxWidth: "78%",
                      padding: isVoice ? "8px 14px" : "8px 14px",
                      fontSize: 13,
                      lineHeight: 1.5,
                      background: isMine ? "hsl(var(--primary))" : "hsl(var(--muted))",
                      color: isMine ? "hsl(var(--primary-foreground))" : "hsl(var(--foreground))",
                      borderRadius: isLastInGroup
                        ? isMine
                          ? "16px 16px 4px 16px"
                          : "16px 16px 16px 4px"
                        : "16px",
                      wordBreak: "break-word",
                    }}
                  >
                    {isVoice ? (
                      <VoiceMessagePlayer url={msg.content} isMine={isMine} />
                    ) : isImage ? (
                      <img
                        src={msg.image_url || msg.content}
                        alt={t("chat.imageMessage")}
                        style={{ borderRadius: 8, maxWidth: "100%", maxHeight: 256, objectFit: "cover", cursor: "pointer" }}
                        onClick={() => window.open(msg.image_url || msg.content, "_blank")}
                      />
                    ) : (
                      <p style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{msg.content}</p>
                    )}
                    {showTime && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          marginTop: 4,
                          justifyContent: isMine ? "flex-end" : "flex-start",
                        }}
                      >
                        <span
                          style={{
                            fontSize: 10,
                            color: isMine ? "hsl(var(--primary-foreground) / 0.6)" : "hsl(var(--muted-foreground))",
                          }}
                        >
                          {new Date(msg.created_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        {isMine && (
                          <span style={{ color: "hsl(var(--primary-foreground) / 0.6)" }}>
                            {msg.read ? (
                              <CheckCheck style={{ width: 12, height: 12 }} />
                            ) : (
                              <Check style={{ width: 12, height: 12 }} />
                            )}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Image Preview */}
      {imagePreview && (
        <div style={{ borderTop: "1px solid var(--border)", background: "var(--card)", padding: "8px 12px", flexShrink: 0 }}>
          <div style={{ position: "relative", display: "inline-block" }}>
            <img src={imagePreview} alt="Preview" style={{ height: 80, borderRadius: 8, objectFit: "cover" }} />
            <button
              onClick={() => { setImagePreview(null); setSelectedFile(null); }}
              style={{
                position: "absolute", top: -6, right: -6,
                background: "hsl(var(--destructive))", color: "white",
                borderRadius: "50%", padding: 2, border: "none", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <X style={{ width: 12, height: 12 }} />
            </button>
          </div>
        </div>
      )}

      {/* Input / Voice Recorder */}
      <div style={{ borderTop: imagePreview ? "none" : "1px solid var(--border)", background: "var(--card)", padding: "10px 12px", flexShrink: 0, paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}>
        {recorder.state === "recording" ? (
          /* Recording UI */
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Button
              variant="ghost"
              size="icon"
              onClick={recorder.cancelRecording}
              style={{ width: 36, height: 36, flexShrink: 0 }}
            >
              <X style={{ width: 20, height: 20 }} />
            </Button>
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "hsl(var(--destructive))", animation: "pulse 1.5s infinite" }} />
              <span style={{ fontSize: 14, fontWeight: 500, color: "hsl(var(--destructive))" }}>
                {formatDuration(recorder.duration)}
              </span>
            </div>
            <Button
              size="icon"
              onClick={recorder.stopRecording}
              style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 12, background: "hsl(var(--destructive))" }}
            >
              <Square style={{ width: 16, height: 16 }} />
            </Button>
          </div>
        ) : recorder.state === "recorded" ? (
          /* Preview & Send UI */
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Button
              variant="ghost"
              size="icon"
              onClick={recorder.cancelRecording}
              style={{ width: 36, height: 36, flexShrink: 0 }}
            >
              <X style={{ width: 20, height: 20 }} />
            </Button>
            <div style={{ flex: 1 }}>
              {recorder.audioUrl && (
                <audio src={recorder.audioUrl} controls style={{ width: "100%", height: 36, borderRadius: 8 }} />
              )}
            </div>
            <Button
              size="icon"
              onClick={handleSendVoice}
              disabled={uploading || sendMessage.isPending}
              style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 12 }}
            >
              {uploading || sendMessage.isPending ? (
                <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" />
              ) : (
                <Send style={{ width: 16, height: 16 }} />
              )}
            </Button>
          </div>
        ) : (
          /* Normal text input */
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageSelect}
              style={{ display: "none" }}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 12 }}
              title={t("common.addImage") as string}
            >
              <ImageIcon style={{ width: 20, height: 20 }} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={recorder.startRecording}
              style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 12 }}
              title={t("chat.voiceMessage") as string}
            >
              <Mic style={{ width: 20, height: 20 }} />
            </Button>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("chat.typeMessage")}
              rows={1}
              style={{ flex: 1, minHeight: 40, maxHeight: 120, padding: "8px 12px", fontSize: 14, lineHeight: 1.4, borderRadius: 12, border: "1px solid var(--input)", background: "var(--background)", color: "var(--foreground)", resize: "none", outline: "none", fontFamily: "inherit" }}
            />
            <Button
              size="icon"
              onClick={imagePreview ? handleSendImage : handleSend}
              disabled={(!input.trim() && !imagePreview) || sendMessage.isPending || uploading}
              style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 12 }}
            >
              {uploading || sendMessage.isPending ? (
                <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" />
              ) : (
                <Send style={{ width: 16, height: 16 }} />
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatPage;
