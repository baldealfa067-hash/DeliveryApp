import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, BellRing } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useUnreadCount } from "@/hooks/useNotifications";
import { useTranslation } from "react-i18next";
import {
  enablePush,
  getPermission,
  hasAsked,
  isStandalone,
  isPushSupported,
  markAsked,
  JUST_SIGNED_UP_KEY,
} from "@/lib/push";

const PushPrompt = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: unread = 0 } = useUnreadCount(user?.id ?? null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (!isPushSupported()) return;
    if (hasAsked()) return;
    if (getPermission() !== "default") return;

    const justSignedUp = sessionStorage.getItem(JUST_SIGNED_UP_KEY) === "1";
    const hasActivity = unread > 0;

    // Mostra discretamente quando o utilizador já está a usar a plataforma:
    // logo após o registo, quando já tem notificações por ler, ou após ~15s
    // numa página da app. Nunca ao abrir o site pela primeira vez na landing.
    // Nota: NÃO bloqueamos o modo standalone — é aí que o push funciona
    // melhor (app instalada no iPhone/Android).
    const delay = justSignedUp ? 800 : hasActivity ? 1500 : 15000;
    const t = setTimeout(() => setOpen(true), delay);
    return () => clearTimeout(t);
  }, [user, unread]);

  const handleEnable = async () => {
    setBusy(true);
    try {
      const { granted, error } = await enablePush();
      if (granted) {
        toast.success(t("pushPrompt.activated"));
      } else if (error) {
        toast.error(error);
      }
      sessionStorage.removeItem(JUST_SIGNED_UP_KEY);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const handleLater = () => {
    markAsked();
    sessionStorage.removeItem(JUST_SIGNED_UP_KEY);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 mb-1">
            <BellRing className="h-6 w-6 text-primary" />
          </div>
          <DialogTitle className="text-center">{t("pushPrompt.title")}</DialogTitle>
          <DialogDescription className="text-center">
            {t("pushPrompt.desc")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col sm:flex-col gap-2">
          <Button onClick={handleEnable} disabled={busy} className="w-full">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("pushPrompt.enable")}
          </Button>
          <Button variant="outline" onClick={handleLater} disabled={busy} className="w-full">
            {t("pushPrompt.later")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PushPrompt;