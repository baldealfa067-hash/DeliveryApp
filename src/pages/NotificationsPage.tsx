import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Bell,
  BellOff,
  Loader2,
  Package,
  Calendar,
  Navigation,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import {
  useNotifications,
  useMarkNotificationsRead,
  type Notification,
} from "@/hooks/useNotifications";
import { useTranslation } from "react-i18next";
import { LanguageSelector } from "@/components/LanguageSelector";

const TYPE_ICONS: Record<string, string> = {
  info: "ℹ️",
  order: "🍔",
  appointment: "💇",
  delivery: "🛵",
  system: "⚙️",
  report: "⚠️",
};

const NotificationsPage = () => {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { data: notifications = [], isLoading } = useNotifications(user?.id ?? null);
  const markRead = useMarkNotificationsRead();

  useEffect(() => {
    if (!loading && !user) navigate("/login", { replace: true });
  }, [user, loading, navigate]);

  useEffect(() => {
    if (notifications.length > 0) {
      const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
      if (unreadIds.length > 0) {
        markRead.mutate(unreadIds);
      }
    }
  }, [notifications]);

  if (loading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground p-2 -m-2 rounded-md">
            <ArrowLeft className="h-4 w-4" /> {t("common.home")}
          </Link>
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold">{t("notifications.title")}</h1>
            <LanguageSelector />
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4 pb-[calc(env(safe-area-inset-bottom))]">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
            <BellOff className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-sm text-muted-foreground">{t("notifications.empty")}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {notifications.map((n) => (
              <NotificationCard key={n.id} notification={n} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

const NotificationCard = ({ notification }: { notification: Notification }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const icon = TYPE_ICONS[notification.type] ?? "ℹ️";

  const handleClick = () => {
    if (notification.reference_type && notification.reference_id) {
      switch (notification.reference_type) {
        case "order":
          navigate(`/pedido/${notification.reference_id}`);
          break;
        case "appointment":
          navigate("/meus-agendamentos");
          break;
        case "delivery":
          navigate("/painel-motorista");
          break;
        default:
          break;
      }
    }
  };

  const timeAgo = getTimeAgo(notification.created_at);

  return (
    <Card
      className={`cursor-pointer transition-colors hover:bg-muted/50 ${
        !notification.is_read ? "border-primary/30 bg-primary/5" : ""
      }`}
      onClick={handleClick}
    >
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          <span className="text-lg shrink-0">{icon}</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{notification.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{notification.message}</p>
            <p className="text-[10px] text-muted-foreground/70 mt-1">{timeAgo}</p>
          </div>
          {!notification.is_read && (
            <div className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />
          )}
        </div>
      </CardContent>
    </Card>
  );
};

function getTimeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `${diffMin}min`;
  if (diffHrs < 24) return `${diffHrs}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString();
}

export default NotificationsPage;
