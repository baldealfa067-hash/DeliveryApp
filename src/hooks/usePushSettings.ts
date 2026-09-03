import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import i18n from "@/i18n";
import {
  disablePush,
  enablePush,
  getExistingSubscription,
  getPermission,
  isPushSupported,
  saveSubscription,
  subscribeToPush,
  subscriptionMatchesVapidKey,
  type PushPermission,
} from "@/lib/push";

export interface PushSettings {
  permission: PushPermission;
  supported: boolean;
  subscribed: boolean;
  pushEnabled: boolean;
  novidades: boolean;
  updating: boolean;
  togglePush: () => Promise<void>;
  setNovidades: (value: boolean) => Promise<void>;
}

export const usePushSettings = (userId: string | null): PushSettings => {
  const [updating, setUpdating] = useState(false);

  const { data: subscription, refetch } = useQuery({
    queryKey: ["push-subscriptions", userId],
    queryFn: async () => {
      if (!userId) return null;
      const { data } = await supabase
        .from("push_subscriptions")
        .select("endpoint, push_enabled, novidades, keys")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!userId && isPushSupported(),
    staleTime: 30_000,
  });

  // Auto-reparação: se o navegador tem uma subscrição mas a BD está sem chaves
  // (bug antigo que gravava p256dh/auth vazios) ou a subscrição usa a chave
  // VAPID antiga (cache), recria/re-guarda com o estado correto.
  useEffect(() => {
    if (!userId || !subscription) return;
    (async () => {
      const existing = await getExistingSubscription();
      if (!existing) return;
      const keys = subscription.keys as { p256dh?: string } | null | undefined;
      if (keys?.p256dh && subscriptionMatchesVapidKey(existing)) return;
      const options = {
        pushEnabled: subscription.push_enabled ?? true,
        novidades: subscription.novidades ?? false,
      };
      if (!subscriptionMatchesVapidKey(existing)) {
        await existing.unsubscribe().catch(() => {});
        const fresh = await subscribeToPush();
        if (!fresh) return;
        await saveSubscription(fresh, options);
      } else {
        await saveSubscription(existing, options);
      }
      refetch();
    })();
  }, [userId, subscription, refetch]);

  const permission = useMemo<PushPermission>(() => {
    if (!isPushSupported()) return "unsupported";
    return getPermission();
  }, [userId]);

  const subscribed = !!subscription;

  const togglePush = useCallback(async () => {
    setUpdating(true);
    try {
      if (subscription?.push_enabled) {
        await disablePush();
        toast.success(i18n.t("push.deactivated"));
      } else {
        const { granted, error } = await enablePush({ pushEnabled: true, novidades: subscription?.novidades ?? false });
        if (error) toast.error(error);
        if (!granted) return;
        toast.success(i18n.t("push.activated"));
      }
      await refetch();
    } finally {
      setUpdating(false);
    }
  }, [subscription, refetch]);

  const setNovidades = useCallback(
    async (value: boolean) => {
      setUpdating(true);
      try {
        const existing = await getExistingSubscription();
        if (existing) {
          await saveSubscription(existing, { pushEnabled: true, novidades: value });
          await refetch();
        }
      } finally {
        setUpdating(false);
      }
    },
    [refetch]
  );

  return {
    permission,
    supported: isPushSupported(),
    subscribed,
    pushEnabled: subscription?.push_enabled ?? false,
    novidades: subscription?.novidades ?? false,
    updating,
    togglePush,
    setNovidades,
  };
};