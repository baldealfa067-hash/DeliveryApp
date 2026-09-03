import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Send,
  MessageSquare,
  Phone,
  ArrowLeft,
  Check,
  CheckCheck,
  Image as ImageIcon,
  MoreVertical,
  Ban,
  ShieldAlert,
  Loader2,
  X,
  Play,
  Pause,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/useAuth";
import { useAnonymousId } from "@/hooks/useAnonymousId";
import {
  useMessages,
  useSendMessage,
  useMarkMessagesAsRead,
  useMessagesRealtime,
} from "@/hooks/useChat";
import { useIsBlockedByMe, useIsBlockedByThem, useBlockUser } from "@/hooks/useBlockedUsers";
import { useReportUser } from "@/hooks/useUserReports";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface ChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  otherUserId: string;
  otherUserName: string;
  otherUserPhone?: string;
  otherUserPhoto?: string | null;
}

const NO_RESPONSE_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const VoicePlayer = ({ url, isMine }: { url: string; isMine: boolean }) => {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.addEventListener("timeupdate", () => {
      if (audio.duration) setProgress((audio.currentTime / audio.duration) * 100);
    });
    audio.addEventListener("ended", () => { setPlaying(false); setProgress(0); });
    return () => { audio.pause(); audio.src = ""; };
  }, [url]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) { audio.pause(); setPlaying(false); }
    else { audio.play(); setPlaying(true); }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 180 }}>
      <button onClick={toggle} style={{
        width: 32, height: 32, borderRadius: "50%", border: "none",
        background: isMine ? "hsl(var(--primary-foreground) / 0.2)" : "hsl(var(--primary) / 0.15)",
        color: "inherit", display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", flexShrink: 0,
      }}>
        {playing ? <Pause style={{ width: 14, height: 14 }} /> : <Play style={{ width: 14, height: 14, marginLeft: 2 }} />}
      </button>
      <div style={{ flex: 1, height: 4, borderRadius: 2, background: isMine ? "hsl(var(--primary-foreground) / 0.2)" : "hsl(var(--muted))", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${progress}%`, borderRadius: 2, background: isMine ? "hsl(var(--primary-foreground) / 0.7)" : "hsl(var(--primary))", transition: "width 0.1s" }} />
      </div>
    </div>
  );
};

export const ChatDialog = ({
  open,
  onOpenChange,
  otherUserId,
  otherUserName,
  otherUserPhone,
  otherUserPhoto,
}: ChatDialogProps) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const anonymousId = useAnonymousId();
  const myId = user?.id ?? anonymousId;
  const isAnon = !user?.id;

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showNoResponseHint, setShowNoResponseHint] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const { data: messages = [], isLoading, isError } = useMessages(myId, otherUserId);
  const sendMessage = useSendMessage();
  const markAsRead = useMarkMessagesAsRead();
  const { data: isBlocked = false } = useIsBlockedByMe(myId, otherUserId);
  const { data: isBlockedByThem = false } = useIsBlockedByThem(myId, otherUserId);
  const blockUser = useBlockUser();
  const reportUser = useReportUser();

  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportDescription, setReportDescription] = useState("");
  const [reporting, setReporting] = useState(false);

  useMessagesRealtime(user?.id ?? null, otherUserId);

  useEffect(() => {
    if (open && user?.id && otherUserId) {
      markAsRead.mutate({ userId: user.id, otherUserId });
    }
  }, [open, user?.id, otherUserId]);

  useEffect(() => {
    if (open) {
      setTimeout(() => textareaRef.current?.focus(), 150);
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, open]);

  useEffect(() => {
    if (!open || messages.length === 0) {
      setShowNoResponseHint(false);
      return;
    }
    const lastMsg = messages[messages.length - 1];
    const isLastFromMe = lastMsg.sender_id === myId;
    if (!isLastFromMe) {
      setShowNoResponseHint(false);
      return;
    }
    const lastMsgTime = new Date(lastMsg.created_at).getTime();
    const now = Date.now();
    if (now - lastMsgTime >= NO_RESPONSE_TIMEOUT_MS) {
      setShowNoResponseHint(true);
    } else {
      const remaining = NO_RESPONSE_TIMEOUT_MS - (now - lastMsgTime);
      const timer = setTimeout(() => setShowNoResponseHint(true), remaining);
      return () => clearTimeout(timer);
    }
  }, [messages, myId, open]);

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

  const uploadAndSendImage = async () => {
    if (!selectedFile || !otherUserId) return;
    setUploading(true);
    try {
      const fileName = `chat/${Date.now()}-${crypto.randomUUID()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from("portfolio")
        .upload(fileName, selectedFile, { contentType: selectedFile.type });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage
        .from("portfolio")
        .getPublicUrl(fileName);
      await sendMessage.mutateAsync({
        senderId: myId,
        receiverId: otherUserId,
        content: urlData.publicUrl,
      });
      setImagePreview(null);
      setSelectedFile(null);
    } catch (err) {
      console.error("[chat] image upload error:", err);
      toast.error(t("chat.sendError"));
    } finally {
      setUploading(false);
    }
  };

  const handleSend = async () => {
    if (selectedFile) {
      await uploadAndSendImage();
      return;
    }
    if (!input.trim()) return;
    if (!otherUserId) {
      toast.error(t("chat.errorNoRecipient"));
      return;
    }
    const content = input.trim();
    setInput("");
    setShowNoResponseHint(false);
    try {
      await sendMessage.mutateAsync({
        senderId: myId,
        receiverId: otherUserId,
        content,
      });
    } catch (err) {
      console.error("[chat] send error:", err);
      toast.error(t("chat.sendError"));
      setInput(content);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleBlock = async () => {
    if (!user?.id) return;
    try {
      await blockUser.mutateAsync({ blockerId: user.id, blockedId: otherUserId });
      toast.success(t("chat.userBlocked"));
      setBlockDialogOpen(false);
      onOpenChange(false);
    } catch {
      toast.error(t("chat.blockError"));
    }
  };

  const handleReport = async () => {
    if (!user?.id || !reportReason.trim()) return;
    setReporting(true);
    try {
      await reportUser.mutateAsync({
        reporterId: user.id,
        reportedId: otherUserId,
        reason: reportReason.trim(),
        description: reportDescription.trim() || undefined,
      });
      toast.success(t("chat.reportSubmitted"));
      setReportDialogOpen(false);
      setReportReason("");
      setReportDescription("");
    } catch {
      toast.error(t("chat.reportError"));
    } finally {
      setReporting(false);
    }
  };

  const groupedMessages: { date: string; messages: typeof messages }[] = [];
  let currentDate = "";
  for (const msg of messages) {
    const msgDate = new Date(msg.created_at).toLocaleDateString();
    if (msgDate !== currentDate) {
      currentDate = msgDate;
      groupedMessages.push({ date: msgDate, messages: [] });
    }
    groupedMessages[groupedMessages.length - 1].messages.push(msg);
  }

  if (!open) return null;

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", flexDirection: "column", background: "var(--background)" }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--border)", background: "var(--card)", flexShrink: 0 }}>
        <Button
          variant="ghost"
          size="icon"
          style={{ width: 36, height: 36, flexShrink: 0 }}
          onClick={() => onOpenChange(false)}
        >
          <ArrowLeft style={{ width: 20, height: 20 }} />
        </Button>
        <Avatar style={{ width: 36, height: 36, flexShrink: 0 }}>
          {otherUserPhoto ? (
            <AvatarImage src={otherUserPhoto} alt={otherUserName} className="object-cover" />
          ) : null}
          <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
            {otherUserName.charAt(0)}
          </AvatarFallback>
        </Avatar>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{otherUserName}</h2>
        </div>
        {otherUserPhone && (
          <a href={`tel:${otherUserPhone.replace(/\s/g, "")}`}>
            <Button variant="ghost" size="icon" style={{ width: 36, height: 36 }}>
              <Phone style={{ width: 20, height: 20 }} />
            </Button>
          </a>
        )}
        {!isAnon && user?.id && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" style={{ width: 36, height: 36 }}>
                <MoreVertical style={{ width: 20, height: 20 }} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => setBlockDialogOpen(true)}
                className="text-destructive gap-2"
              >
                <Ban className="h-4 w-4" />
                {isBlocked ? t("chat.unblock") : t("chat.block")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setReportDialogOpen(true)}
                className="gap-2"
              >
                <ShieldAlert className="h-4 w-4" />
                {t("chat.reportUser")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Messages — scrollable area */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 8px 16px" }}>
        {!otherUserId && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", textAlign: "center", color: "var(--muted-foreground)" }}>
            <p style={{ fontSize: 14 }}>{t("chat.errorNoRecipient")}</p>
          </div>
        )}

        {otherUserId && isLoading && messages.length === 0 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--muted-foreground)" }}>
            <p style={{ fontSize: 14 }}>{t("common.loading")}</p>
          </div>
        )}

        {otherUserId && isError && !isLoading && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", textAlign: "center", color: "var(--muted-foreground)" }}>
            <p style={{ fontSize: 14, fontWeight: 500 }}>{t("chat.loadError")}</p>
            <p style={{ fontSize: 12, marginTop: 4 }}>{t("chat.loadErrorHint")}</p>
          </div>
        )}

        {otherUserId && !isLoading && !isError && messages.length === 0 && (
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

              const isVoice = (msg as Record<string, unknown>).message_type === "voice";
              const isImage = !isVoice && (
                (msg as Record<string, unknown>).message_type === "image" ||
                msg.content.match(/\.(jpg|jpeg|png|gif|webp)/i) ||
                (msg.content.includes("/portfolio/") && !msg.content.includes("/voice/"))
              );

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
                      padding: "8px 14px",
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
                      <VoicePlayer url={msg.content} isMine={isMine} />
                    ) : isImage ? (
                      <img
                        src={msg.content}
                        alt={t("chat.imageMessage")}
                        style={{ borderRadius: 8, maxWidth: "100%", maxHeight: 256, objectFit: "cover", cursor: "pointer" }}
                        onClick={() => window.open(msg.content, "_blank")}
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
                        {isMine && !isAnon && (
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

        {showNoResponseHint && otherUserPhone && (
          <div style={{ display: "flex", justifyContent: "center", margin: "12px 0" }}>
            <div style={{ background: "hsl(var(--muted) / 0.8)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 16px", textAlign: "center", maxWidth: "85%" }}>
              <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 8 }}>
                {t("chat.noResponseHint")}
              </p>
              <a href={`tel:${otherUserPhone.replace(/\s/g, "")}`}>
                <Button size="sm" variant="secondary" style={{ gap: 6, fontSize: 12 }}>
                  <Phone style={{ width: 14, height: 14 }} />
                  {t("common.call")}
                </Button>
              </a>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Image preview */}
      {imagePreview && (
        <div style={{ borderTop: "1px solid var(--border)", background: "var(--card)", padding: "8px 12px", flexShrink: 0 }}>
          <div style={{ position: "relative", display: "inline-block" }}>
            <img
              src={imagePreview}
              alt="Preview"
              style={{ height: 80, borderRadius: 8, objectFit: "cover" }}
            />
            <button
              onClick={() => {
                setImagePreview(null);
                setSelectedFile(null);
              }}
              style={{
                position: "absolute",
                top: -6,
                right: -6,
                background: "hsl(var(--destructive))",
                color: "white",
                borderRadius: "50%",
                padding: 2,
                border: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <X style={{ width: 12, height: 12 }} />
            </button>
          </div>
        </div>
      )}

      {/* INPUT SECTION — always visible at bottom */}
      <div
        style={{
          borderTop: "1px solid var(--border)",
          background: "var(--card)",
          padding: "10px 12px",
          flexShrink: 0,
          paddingBottom: "max(10px, env(safe-area-inset-bottom))",
        }}
      >
        {isBlockedByThem && (
          <p style={{ fontSize: 12, color: "hsl(var(--destructive))", textAlign: "center", marginBottom: 8 }}>
            {t("chat.blockedByThem")}
          </p>
        )}
        {isAnon && !isBlockedByThem && (
          <p style={{ fontSize: 10, color: "var(--muted-foreground)", textAlign: "center", marginBottom: 8 }}>
            {t("chat.anonymousHint")}
          </p>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleImageSelect}
          />
          <Button
            size="icon"
            variant="ghost"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || isBlockedByThem}
            style={{ width: 40, height: 40, flexShrink: 0 }}
          >
            <ImageIcon style={{ width: 20, height: 20 }} />
          </Button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isBlockedByThem ? t("chat.cannotSend") : t("chat.typeMessage")}
            disabled={uploading || isBlockedByThem}
            rows={1}
            style={{
              flex: 1,
              minHeight: 40,
              maxHeight: 120,
              padding: "8px 12px",
              fontSize: 14,
              lineHeight: 1.4,
              borderRadius: 12,
              border: "1px solid var(--input)",
              background: "var(--background)",
              color: "var(--foreground)",
              resize: "none",
              outline: "none",
              fontFamily: "inherit",
            }}
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={(!input.trim() && !selectedFile) || sendMessage.isPending || uploading || isBlockedByThem}
            style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 12 }}
          >
            {uploading ? (
              <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" />
            ) : (
              <Send style={{ width: 16, height: 16 }} />
            )}
          </Button>
        </div>
      </div>

      {/* Block Dialog */}
      <Dialog open={blockDialogOpen} onOpenChange={setBlockDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("chat.blockTitle")}</DialogTitle>
            <DialogDescription>{t("chat.blockDesc", { name: otherUserName })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlockDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleBlock} disabled={blockUser.isPending}>
              {blockUser.isPending ? t("common.saving") : t("chat.block")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Report Dialog */}
      <Dialog open={reportDialogOpen} onOpenChange={setReportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("chat.reportTitle")}</DialogTitle>
            <DialogDescription>{t("chat.reportDesc", { name: otherUserName })}</DialogDescription>
          </DialogHeader>
          <div style={{ display: "grid", gap: 16, padding: "8px 0" }}>
            <div style={{ display: "grid", gap: 8 }}>
              <Label>{t("chat.reportReason")}</Label>
              <select
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
                style={{ border: "1px solid var(--input)", borderRadius: 6, padding: "8px 12px", fontSize: 14, background: "var(--background)" }}
              >
                <option value="">{t("chat.selectReason")}</option>
                <option value="spam">{t("chat.reportReasons.spam")}</option>
                <option value="harassment">{t("chat.reportReasons.harassment")}</option>
                <option value="inappropriate">{t("chat.reportReasons.inappropriate")}</option>
                <option value="scam">{t("chat.reportReasons.scam")}</option>
                <option value="other">{t("chat.reportReasons.other")}</option>
              </select>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              <Label>{t("chat.reportDetails")}</Label>
              <Textarea
                placeholder={t("chat.reportDetailsPlaceholder")}
                value={reportDescription}
                onChange={(e) => setReportDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReportDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleReport} disabled={!reportReason || reporting} className="gap-2">
              <ShieldAlert className="h-4 w-4" />
              {reporting ? t("common.submitting") : t("chat.reportUser")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
