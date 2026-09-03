import { useEffect } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import i18n from "@/i18n";
import { supabase } from "@/integrations/supabase/client";
import {
  getExistingSubscription,
  getPermission,
  isPushSupported,
  saveSubscription,
  subscribeToPush,
  subscriptionMatchesVapidKey,
} from "@/lib/push";

/**
 * Repara automaticamente o estado push para o utilizador com sessão:
 * - Se a permissão do sistema já foi concedida e não há subscrição no
 *   navegador, cria uma nova (não precisa de gesto — só o pedido de
 *   permissão o exige, e já foi concedido).
 * - Se a subscrição da BD está sem chaves (bug antigo) ou ligada a uma
 *   chave VAPID antiga (cache), recria/re-guarda com o estado correto.
 * - Se a subscrição da BD não existe mas o navegador tem uma, guarda-a.
 * Corre em qualquer página da app, sempre que abre com sessão.
 */
const PushRepair = () => {
  const { user } = useAuth();

  useEffect(() => {
    if (!user || !isPushSupported()) return;
    let cancelled = false;
    (async () => {
      try {
        let existing = await getExistingSubscription();
        if (!existing) {
          if (getPermission() !== "granted") return;
          existing = await subscribeToPush();
        }
        if (!existing) return;

        const { data } = await supabase
          .from("push_subscriptions")
          .select("endpoint, push_enabled, novidades, keys")
          .eq("user_id", user.id)
          .limit(1)
          .maybeSingle();

        const keys = data?.keys as { p256dh?: string } | null | undefined;
        if (data && keys?.p256dh && subscriptionMatchesVapidKey(existing)) {
          return; // tudo certo
        }

        const options = {
          pushEnabled: data?.push_enabled ?? true,
          novidades: data?.novidades ?? false,
        };

        if (!subscriptionMatchesVapidKey(existing)) {
          await existing.unsubscribe().catch(() => {});
          const fresh = await subscribeToPush();
          if (!fresh) return;
          await saveSubscription(fresh, options);
        } else {
          await saveSubscription(existing, options);
        }

        if (!cancelled) {
          toast.success(i18n.t("push.repaired"));
        }
      } catch (e) {
        console.error("push repair failed:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  return null;
};

export default PushRepair;