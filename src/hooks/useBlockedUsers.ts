import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface BlockedUser {
  id: string;
  blocker_id: string;
  blocked_id: string;
  created_at: string;
}

export const useBlockedUsers = (userId: string | null) =>
  useQuery({
    queryKey: ["blocked-users", userId],
    queryFn: async (): Promise<BlockedUser[]> => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from("blocked_users")
        .select("*")
        .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`);
      if (error) throw error;
      return (data ?? []) as BlockedUser[];
    },
    enabled: !!userId,
  });

export const useIsBlockedByMe = (userId: string | null, otherUserId: string | null) =>
  useQuery({
    queryKey: ["blocked-by-me", userId, otherUserId],
    queryFn: async (): Promise<boolean> => {
      if (!userId || !otherUserId) return false;
      const { count, error } = await supabase
        .from("blocked_users")
        .select("id", { count: "exact", head: true })
        .eq("blocker_id", userId)
        .eq("blocked_id", otherUserId);
      if (error) throw error;
      return (count ?? 0) > 0;
    },
    enabled: !!userId && !!otherUserId,
  });

export const useIsBlockedByThem = (userId: string | null, otherUserId: string | null) =>
  useQuery({
    queryKey: ["blocked-by-them", userId, otherUserId],
    queryFn: async (): Promise<boolean> => {
      if (!userId || !otherUserId) return false;
      const { count, error } = await supabase
        .from("blocked_users")
        .select("id", { count: "exact", head: true })
        .eq("blocker_id", otherUserId)
        .eq("blocked_id", userId);
      if (error) throw error;
      return (count ?? 0) > 0;
    },
    enabled: !!userId && !!otherUserId,
  });

export const useBlockUser = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ blockerId, blockedId }: { blockerId: string; blockedId: string }) => {
      const { error } = await supabase.from("blocked_users").insert({
        blocker_id: blockerId,
        blocked_id: blockedId,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["blocked-users", variables.blockerId] });
      qc.invalidateQueries({ queryKey: ["blocked-by-me", variables.blockerId, variables.blockedId] });
    },
  });
};

export const useUnblockUser = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ blockerId, blockedId }: { blockerId: string; blockedId: string }) => {
      const { error } = await supabase
        .from("blocked_users")
        .delete()
        .eq("blocker_id", blockerId)
        .eq("blocked_id", blockedId);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["blocked-users", variables.blockerId] });
      qc.invalidateQueries({ queryKey: ["blocked-by-me", variables.blockerId, variables.blockedId] });
    },
  });
};

export const useBlockedUserIds = (userId: string | null) =>
  useQuery({
    queryKey: ["blocked-user-ids", userId],
    queryFn: async (): Promise<Set<string>> => {
      if (!userId) return new Set();
      const { data, error } = await supabase
        .from("blocked_users")
        .select("blocker_id, blocked_id")
        .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`);
      if (error) throw error;
      const ids = new Set<string>();
      for (const row of data ?? []) {
        if (row.blocker_id === userId) ids.add(row.blocked_id);
        if (row.blocked_id === userId) ids.add(row.blocker_id);
      }
      return ids;
    },
    enabled: !!userId,
  });
