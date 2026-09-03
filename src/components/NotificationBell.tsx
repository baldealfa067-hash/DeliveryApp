import { useState } from "react";
import { Link } from "react-router-dom";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { useAuth } from "@/hooks/useAuth";
import { useNotifications, useUnreadCount, useMarkAsRead, useMarkAllAsRead, useNotificationsRealtime, type Notification } from "@/hooks/useNotifications";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";

export function NotificationBell() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const { data: notifications = [] } = useNotifications(user?.id ?? null);
  const { data: unread = 0 } = useUnreadCount(user?.id ?? null);
  const markRead = useMarkAsRead();
  const markAllRead = useMarkAllAsRead();
  useNotificationsRealtime(user?.id ?? null);

  if (!user) return null;

  const handleOpen = () => {
    setOpen(true);
    if (unread > 0) {
      markAllRead.mutate(user.id);
    }
  };

  const handleClick = (n: Notification) => {
    markRead.mutate(n.id);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9" onClick={handleOpen}>
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="border-b border-border px-4 py-3 flex items-center justify-between">
          <h3 className="font-semibold text-sm">{t("notificationBell.notifications")}</h3>
          {unread > 0 && (
            <span className="text-xs text-primary">{t("notificationBell.new", { count: unread })}</span>
          )}
        </div>
        <ScrollArea className="max-h-80">
          {notifications.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {t("notificationBell.noNotifications")}
            </p>
          ) : (
            <div className="divide-y divide-border">
              {notifications.map((n) => (
                <Link
                  key={n.id}
                  to={n.link ?? "/pedidos"}
                  onClick={() => handleClick(n)}
                  className={`block px-4 py-3 hover:bg-muted/50 transition-colors ${
                    !n.read ? "bg-primary/5" : ""
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {!n.read && (
                      <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm ${!n.read ? "font-semibold" : "font-medium"}`}>
                        {n.title}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {n.body}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {formatTimeAgo(n.created_at)}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return i18n.t("notificationBell.now");
  if (mins < 60) return i18n.t("notificationBell.minutesAgo", { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return i18n.t("notificationBell.hoursAgo", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return i18n.t("notificationBell.daysAgo", { count: days });
  return new Date(dateStr).toLocaleDateString(i18n.language);
}
