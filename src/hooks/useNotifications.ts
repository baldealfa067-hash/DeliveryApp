import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  reference_type: string | null;
  reference_id: string | null;
  is_read: boolean;
  created_at: string;
  // Compat aliases for NotificationBell
  read: boolean;
  body: string;
  link: string | null;
}

const cleanNotificationMessage = (msg: string): string => {
  if (msg.includes("supabase.co") || msg.includes("mensagem")) {
    const sender = msg.split(":")[0];
    return `${sender}: [imagem/voz]`;
  }
  return msg;
};

const mapNotification = (n: Record<string, unknown>): Notification => {
  const refType = n.reference_type as string | null;
  const refId = n.reference_id as string | null;
  const dbLink = n.link as string | null;

  // Prefer DB-computed link; fall back to building it
  let computedLink: string | null = dbLink;
  if (!computedLink && refType && refId) {
    if (refType === "chat") {
      computedLink = `/mensagem/${refId}`;
    } else if (refType === "order") {
      computedLink = `/pedido/${refId}`;
    } else if (refType === "appointment") {
      computedLink = `/meus-agendamentos/${refId}`;
    }
  }

  return {
    id: n.id as string,
    title: n.title as string,
    message: cleanNotificationMessage((n.message as string) ?? (n.body as string) ?? ""),
    type: n.type as string,
    reference_type: refType,
    reference_id: refId,
    is_read: (n.is_read as boolean) ?? (n.read as boolean) ?? false,
    created_at: n.created_at as string,
    read: (n.is_read as boolean) ?? (n.read as boolean) ?? false,
    body: cleanNotificationMessage((n.body as string) ?? (n.message as string) ?? ""),
    link: computedLink,
  };
};

export const useNotifications = (userId: string | null) =>
  useQuery({
    queryKey: ["notifications", userId],
    queryFn: async (): Promise<Notification[]> => {
      if (!userId) return [];
      const { data, error } = await supabase.rpc("get_my_notifications");
      if (error) throw error;
      return (data ?? []).map(mapNotification);
    },
    enabled: !!userId,
  });

export const useUnreadCount = (userId: string | null) =>
  useQuery({
    queryKey: ["notifications-unread", userId],
    queryFn: async (): Promise<number> => {
      if (!userId) return 0;
      const { data, error } = await supabase.rpc("get_unread_notifications_count");
      if (error) throw error;
      return (data ?? 0) as number;
    },
    enabled: !!userId,
    refetchInterval: 30000,
  });

export const useMarkNotificationsRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids?: string[]) => {
      const { error } = await supabase.rpc("mark_notifications_read", {
        p_ids: ids ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["notifications-unread"] });
    },
  });
};

// Alias for NotificationBell
export const useMarkAsRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("mark_notifications_read", {
        p_ids: [id],
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["notifications-unread"] });
    },
  });
};

// Alias for NotificationBell
export const useMarkAllAsRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_userId?: string) => {
      const { error } = await supabase.rpc("mark_notifications_read", {
        p_ids: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["notifications-unread"] });
    },
  });
};

// Realtime subscription for notifications
export const useNotificationsRealtime = (userId: string | null) => {
  const qc = useQueryClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!userId) return;

    // Cleanup previous channel if exists
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase
      .channel("notifications-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["notifications"] });
          qc.invalidateQueries({ queryKey: ["notifications-unread"] });
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [userId, qc]);
};

export const useCreateNotification = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      userId: string;
      title: string;
      message: string;
      type?: string;
      referenceType?: string;
      referenceId?: string;
    }) => {
      const { data, error } = await supabase.rpc("create_notification", {
        p_user_id: params.userId,
        p_title: params.title,
        p_message: params.message,
        p_type: params.type ?? "info",
        p_reference_type: params.referenceType ?? null,
        p_reference_id: params.referenceId ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["notifications-unread"] });
    },
  });
};
