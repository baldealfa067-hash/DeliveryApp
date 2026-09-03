import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { MessageSquare, ArrowLeft, Loader2 } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useConversations, type ConversationPreview } from "@/hooks/useChat";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "react-i18next";

type ProfileInfo = {
  user_id: string;
  name: string;
  photo_url: string | null;
  profile_type: string;
};

const ConversationsPage = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: conversations = [], isLoading } = useConversations(user?.id ?? null);
  const [profiles, setProfiles] = useState<Map<string, ProfileInfo>>(new Map());
  const fetchIdsRef = useRef<string>("");

  useEffect(() => {
    if (!conversations.length) return;
    const ids = conversations.map((c) => c.otherUserId).sort().join(",");
    // Prevent refetching same IDs
    if (ids === fetchIdsRef.current) return;
    fetchIdsRef.current = ids;

    const fetchProfiles = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, name, photo_url, profile_type")
        .in("user_id", conversations.map((c) => c.otherUserId));
      if (data) {
        const map = new Map<string, ProfileInfo>();
        for (const p of data) {
          map.set(p.user_id, p as ProfileInfo);
        }
        setProfiles(map);
      }
    };
    fetchProfiles();
  }, [conversations]);

  if (!user) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-6">
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
          <MessageSquare className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="text-muted-foreground">{t("chat.loginRequired")}</p>
          <Button onClick={() => navigate("/login")} className="mt-4">
            {t("auth.login")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-20">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-bold">{t("conversations.title")}</h1>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {!isLoading && conversations.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <MessageSquare className="h-8 w-8 text-primary/50" />
          </div>
          <p className="text-sm font-medium text-muted-foreground">{t("conversations.empty")}</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-[250px]">{t("conversations.emptyHint")}</p>
        </div>
      )}

      {!isLoading && conversations.length > 0 && (
        <div className="divide-y divide-border">
          {conversations.map((conv) => {
            const profile = profiles.get(conv.otherUserId);
            const name = profile?.name ?? conv.otherUserId.slice(0, 8);
            const photoUrl = profile?.photo_url ?? null;
            const initials = name.slice(0, 2).toUpperCase();
            const isImage = conv.lastMessage.startsWith("data:image") || conv.lastMessage.includes("/portfolio/") || conv.lastMessage.match(/\.(jpg|jpeg|png|gif|webp)/i);

            return (
              <button
                key={conv.otherUserId}
                className="w-full flex items-center gap-3 px-1 py-3 hover:bg-muted/50 transition-colors text-left"
                onClick={() => {
                  navigate(`/mensagem/${conv.otherUserId}`);
                }}
              >
                <Avatar className="h-12 w-12 shrink-0">
                  {photoUrl ? (
                    <AvatarImage src={photoUrl} alt={name} className="object-cover" />
                  ) : null}
                  <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-sm truncate ${conv.unreadCount > 0 ? "font-bold" : "font-semibold"}`}>{name}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {new Date(conv.lastMessageAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <p className={`text-xs truncate ${conv.unreadCount > 0 ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                      {isImage
                        ? `📷 ${t("conversations.image")}`
                        : conv.lastMessage}
                    </p>
                    {conv.unreadCount > 0 && (
                      <Badge className="bg-primary text-primary-foreground text-[10px] font-bold h-5 min-w-[20px] rounded-full flex items-center justify-center px-1 shrink-0">
                        {conv.unreadCount > 99 ? "99+" : conv.unreadCount}
                      </Badge>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

    </div>
  );
};

export default ConversationsPage;
