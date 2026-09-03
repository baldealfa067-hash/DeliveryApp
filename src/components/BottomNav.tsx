import { Home, Search, ClipboardList, MessageSquare, User } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { useUnreadCount } from "@/hooks/useNotifications";
import { Badge } from "@/components/ui/badge";

export const BottomNav = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: unreadCount = 0 } = useUnreadCount(user?.id ?? null);
  const items = [
    { to: "/inicio", icon: Home, label: t("bottomNav.home") },
    { to: "/explorar", icon: Search, label: t("bottomNav.explore") },
    { to: "/conversas", icon: MessageSquare, label: t("bottomNav.chat") },
    { to: "/pedidos", icon: ClipboardList, label: t("bottomNav.requests") },
    { to: "/perfil", icon: User, label: t("bottomNav.profile") },
  ];
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-card/95 backdrop-blur-md safe-area-bottom">
      <div className="flex justify-around items-center h-16 max-w-lg mx-auto">
        {items.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className="relative flex flex-col items-center gap-0.5 px-2 py-2 text-muted-foreground transition-colors"
            activeClassName="text-primary"
          >
            <Icon className="h-5 w-5" />
            {to === "/perfil" && unreadCount > 0 && (
              <Badge className="absolute -top-0.5 -right-1 h-4 min-w-[16px] text-[9px] px-1 flex items-center justify-center">
                {unreadCount > 9 ? "9+" : unreadCount}
              </Badge>
            )}
            <span className="text-[10px] font-medium">{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
};
