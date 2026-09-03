import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";

export interface Message {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  read: boolean;
  created_at: string;
  message_type?: string | null;
  image_url?: string | null;
}

export interface ConversationPreview {
  otherUserId: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
}

export const useMessages = (userId: string | null, otherUserId: string | null) =>
  useQuery({
    queryKey: ["messages", userId, otherUserId],
    queryFn: async (): Promise<Message[]> => {
      if (!userId || !otherUserId) return [];
      const isAnon = userId.startsWith("anon-");
      let query = supabase
        .from("messages")
        .select("*")
        .order("created_at", { ascending: true });

      if (isAnon) {
        query = query.or(
          `sender_id.eq.${userId},receiver_id.eq.${otherUserId}`
        );
      } else {
        query = query.or(
          `and(sender_id.eq.${userId},receiver_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},receiver_id.eq.${userId})`
        );
      }

      const { data, error } = await query;
      if (error) {
        console.error("[chat] useMessages error:", error.message, error);
        throw error;
      }
      return (data ?? []) as Message[];
    },
    enabled: !!userId && !!otherUserId && otherUserId.length > 0,
    retry: 1,
    staleTime: 10000,
  });

export const useSendMessage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      senderId,
      receiverId,
      content,
      messageType,
      imageUrl,
    }: {
      senderId: string | null;
      receiverId: string;
      content: string;
      messageType?: string;
      imageUrl?: string;
    }) => {
      const insertData: Record<string, unknown> = {
        sender_id: senderId,
        receiver_id: receiverId,
        content,
      };
      if (messageType) insertData.message_type = messageType;
      if (imageUrl) insertData.image_url = imageUrl;
      const { error: msgError } = await supabase.from("messages").insert(insertData);
      if (msgError) throw msgError;

      // Create notification for the receiver (non-blocking, only for authenticated senders)
      if (senderId && !senderId.startsWith("anon-")) {
        supabase
          .from("profiles")
          .select("name")
          .eq("user_id", senderId)
          .maybeSingle()
          .then(({ data: senderProfile }) => {
            const senderName = senderProfile?.name || "Alguém";
            let preview: string;
            if (messageType === "voice") {
              preview = "🎤 Mensagem de voz";
            } else if (messageType === "image") {
              preview = "🖼️ Imagem";
            } else {
              preview = content.length > 80 ? content.slice(0, 80) + "..." : content;
            }
            return supabase.rpc("create_notification", {
              p_user_id: receiverId,
              p_title: "Nova mensagem",
              p_message: `${senderName}: ${preview}`,
              p_type: "chat_message",
              p_reference_type: "chat",
              p_reference_id: senderId,
            });
          })
          .catch((err) => console.error("[chat] notification error:", err));
      }
    },
    onMutate: async (variables) => {
      if (!variables.senderId) return;

      // Cancel outgoing refetches
      await qc.cancelQueries({
        queryKey: ["messages", variables.senderId, variables.receiverId],
      });

      // Snapshot current cache
      const previous = qc.getQueryData<Message[]>(
        ["messages", variables.senderId, variables.receiverId]
      );

      // Optimistically insert message
      const optimistic: Message = {
        id: crypto.randomUUID(),
        sender_id: variables.senderId,
        receiver_id: variables.receiverId,
        content: variables.content,
        read: false,
        created_at: new Date().toISOString(),
        message_type: variables.messageType ?? null,
        image_url: variables.imageUrl ?? null,
      };

      qc.setQueryData<Message[]>(
        ["messages", variables.senderId, variables.receiverId],
        (old) => [...(old ?? []), optimistic]
      );

      return { previous };
    },
    onError: (_err, variables, context) => {
      // Rollback on error
      if (context?.previous !== undefined && variables.senderId) {
        qc.setQueryData(
          ["messages", variables.senderId, variables.receiverId],
          context.previous
        );
      }
    },
    onSettled: (_data, _error, variables) => {
      if (variables.senderId) {
        qc.invalidateQueries({
          queryKey: ["messages", variables.senderId, variables.receiverId],
        });
        qc.invalidateQueries({
          queryKey: ["messages", variables.receiverId, variables.senderId],
        });
      }
      qc.invalidateQueries({ queryKey: ["unread-messages"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
};

export const useUnreadMessagesCount = (userId: string | null) =>
  useQuery({
    queryKey: ["unread-messages", userId],
    queryFn: async (): Promise<number> => {
      if (!userId) return 0;
      const { count, error } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("receiver_id", userId)
        .eq("read", false);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!userId,
    refetchInterval: 5000,
  });

export const useUnreadFromUser = (
  userId: string | null,
  otherUserId: string | null
) =>
  useQuery({
    queryKey: ["unread-from", userId, otherUserId],
    queryFn: async (): Promise<number> => {
      if (!userId || !otherUserId) return 0;
      const { count, error } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("receiver_id", userId)
        .eq("sender_id", otherUserId)
        .eq("read", false);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!userId && !!otherUserId,
    refetchInterval: 5000,
  });

export const useConversations = (userId: string | null) =>
  useQuery({
    queryKey: ["conversations", userId],
    queryFn: async (): Promise<ConversationPreview[]> => {
      if (!userId) return [];

      // Get all messages involving this user
      const { data: messages, error } = await supabase
        .from("messages")
        .select("*")
        .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      if (!messages || messages.length === 0) return [];

      // Group by conversation partner, count unread in one pass
      const convMap = new Map<
        string,
        { lastMessage: string; lastMessageAt: string; unreadCount: number }
      >();

      for (const msg of messages as Message[]) {
        const otherId =
          msg.sender_id === userId ? msg.receiver_id : msg.sender_id;
        if (!otherId) continue;
        if (!convMap.has(otherId)) {
          convMap.set(otherId, {
            lastMessage: msg.content,
            lastMessageAt: msg.created_at,
            unreadCount: 0,
          });
        }
        const conv = convMap.get(otherId)!;
        // Count messages from partner that are unread
        if (msg.receiver_id === userId && !msg.read) {
          conv.unreadCount++;
        }
      }

      // Convert to array and sort by most recent
      const previews: ConversationPreview[] = Array.from(convMap.entries()).map(
        ([otherUserId, preview]) => ({
          otherUserId,
          lastMessage: preview.lastMessage,
          lastMessageAt: preview.lastMessageAt,
          unreadCount: preview.unreadCount,
        })
      );

      previews.sort(
        (a, b) =>
          new Date(b.lastMessageAt).getTime() -
          new Date(a.lastMessageAt).getTime()
      );

      return previews;
    },
    enabled: !!userId,
    refetchInterval: 5000,
  });

export const useMarkMessagesAsRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      userId,
      otherUserId,
    }: {
      userId: string;
      otherUserId: string;
    }) => {
      const { error } = await supabase
        .from("messages")
        .update({ read: true })
        .eq("receiver_id", userId)
        .eq("sender_id", otherUserId)
        .eq("read", false);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["unread-messages"] });
      qc.invalidateQueries({ queryKey: ["unread-from"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
};

export const useMessagesRealtime = (
  userId: string | null,
  otherUserId: string | null
) => {
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId || !otherUserId) return;
    const channel = supabase
      .channel(`messages-${userId}-${otherUserId}-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        (payload) => {
          const msg = payload.new as Message;
          if (
            (msg.sender_id === userId && msg.receiver_id === otherUserId) ||
            (msg.sender_id === otherUserId && msg.receiver_id === userId)
          ) {
            qc.invalidateQueries({
              queryKey: ["messages", userId, otherUserId],
            });
            qc.invalidateQueries({ queryKey: ["unread-messages"] });
            qc.invalidateQueries({ queryKey: ["unread-from"] });
            qc.invalidateQueries({ queryKey: ["conversations"] });
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
        },
        (payload) => {
          const msg = payload.new as Message;
          if (
            (msg.sender_id === userId && msg.receiver_id === otherUserId) ||
            (msg.sender_id === otherUserId && msg.receiver_id === userId)
          ) {
            qc.invalidateQueries({
              queryKey: ["messages", userId, otherUserId],
            });
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, otherUserId, qc]);
};
