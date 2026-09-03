import { supabase } from "@/integrations/supabase/client";
import i18n from "@/i18n";

export const VAPID_PUBLIC_KEY =
  import.meta.env.VITE_VAPID_PUBLIC_KEY ??
  "BMfnEZU0xnlB8nBXxrIODMPgr1WZD9kpehlwQViOCTOzBh6uZZGXHIxuFMYSS5sXhu3NiBqe5MQPVtbuB_2qJO4";

const ASKED_KEY = "bornaal:push-asked";
export const JUST_SIGNED_UP_KEY = "bornaal:just-signed-up";

export type PushPermission = "granted" | "denied" | "default" | "unsupported";

export const isPushSupported = (): boolean =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

export const isStandalone = (): boolean =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true);

export const isIOS = (): boolean =>
  typeof navigator !== "undefined" &&
  /iphone|ipad|ipod/i.test(navigator.userAgent || "");

export const getPermission = (): PushPermission => {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission as PushPermission;
};

export const hasAsked = (): boolean => localStorage.getItem(ASKED_KEY) !== null;

export const markAsked = (): void => localStorage.setItem(ASKED_KEY, "1");

export const clearAsked = (): void => localStorage.removeItem(ASKED_KEY);

const urlBase64ToUint8Array = (base64: string): Uint8Array => {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Url = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Url);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
};

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);

export const getExistingSubscription = async (): Promise<PushSubscription | null> => {
  if (!isPushSupported()) return null;
  const reg = await withTimeout(navigator.serviceWorker.ready, 15000);
  return reg.pushManager.getSubscription();
};

export const subscribeToPush = async (): Promise<PushSubscription | null> => {
  if (!isPushSupported()) return null;
  const reg = await withTimeout(navigator.serviceWorker.ready, 15000);
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
};

/**
 * Verifica se uma subscrição existente está ligada à chave VAPID atual.
 * Se a app foi carregada de cache com a chave antiga, a subscrição fica
 * presa a essa chave e a FCM rejeitaria os envios — é preciso recriá-la.
 */
export const subscriptionMatchesVapidKey = (sub: PushSubscription | null): boolean => {
  if (!sub) return false;
  const bytes = sub.options?.applicationServerKey;
  if (!bytes) return false;
  const current = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
  const stored = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (stored.length !== current.length) return false;
  return current.every((b, i) => b === stored[i]);
};

export const unsubscribeFromPush = async (): Promise<void> => {
  const sub = await getExistingSubscription();
  if (sub) {
    await sub.unsubscribe().catch(() => {});
  }
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (userId) {
    await supabase.from("push_subscriptions").delete().eq("user_id", userId).catch(() => {});
  }
};

export const saveSubscription = async (
  subscription: PushSubscription,
  options: { pushEnabled: boolean; novidades: boolean }
): Promise<void> => {
  const json = subscription.toJSON() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  const endpoint = json.endpoint ?? subscription.endpoint;
  const keys = { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" };
  const { error } = await supabase.rpc("upsert_push_subscription", {
    p_endpoint: endpoint,
    p_keys: keys,
    p_push_enabled: options.pushEnabled,
    p_novidades: options.novidades,
  });
  if (error) throw error;
};

/**
 * Ativa as notificações push: pede permissão e guarda a subscrição.
 * Deve ser chamado a partir de um gesto do utilizador (clique).
 */
export const enablePush = async (options: {
  pushEnabled?: boolean;
  novidades?: boolean;
} = {}): Promise<{ granted: boolean; error?: string }> => {
  if (!isPushSupported()) return { granted: false, error: i18n.t("pushErrors.notSupported") };
  let permission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission().catch(() => "denied" as NotificationPermission);
  }
  if (permission !== "granted") {
    markAsked();
    return { granted: false, error: i18n.t("pushErrors.permissionDenied") };
  }
  try {
    // Se já existe uma subscrição mas com a chave VAPID errada (cache antiga),
    // recria-a com a chave atual antes de guardar.
    let subscription = await getExistingSubscription();
    if (subscription && !subscriptionMatchesVapidKey(subscription)) {
      await subscription.unsubscribe().catch(() => {});
      subscription = await subscribeToPush();
    } else if (!subscription) {
      subscription = await subscribeToPush();
    }
    if (!subscription) return { granted: false, error: i18n.t("pushErrors.createFailed") };
    await saveSubscription(subscription, {
      pushEnabled: options.pushEnabled ?? true,
      novidades: options.novidades ?? false,
    });
  } catch (err) {
    return { granted: false, error: i18n.t("pushErrors.activateFailed", { msg: (err as Error)?.message ?? i18n.t("pushErrors.unknown") }) };
  }
  markAsked();
  return { granted: true };
};

export const disablePush = async (): Promise<void> => {
  await unsubscribeFromPush();
};