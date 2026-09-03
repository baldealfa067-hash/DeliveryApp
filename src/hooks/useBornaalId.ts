import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface BornaalUserProfile {
  user_id: string;
  bornaal_id: string;
  full_name: string;
  avatar_url: string | null;
}

export const useMyBornaalId = (userId: string | null) =>
  useQuery({
    queryKey: ["bornaal-id", userId],
    queryFn: async (): Promise<string | null> => {
      if (!userId) return null;
      const { data, error } = await supabase.rpc("get_my_bornaal_id");
      if (error) throw error;
      return (data as string) ?? null;
    },
    enabled: !!userId,
  });

export const useLookupBornaalId = (bornaalId: string | null) =>
  useQuery({
    queryKey: ["bornaal-lookup", bornaalId],
    queryFn: async (): Promise<BornaalUserProfile | null> => {
      if (!bornaalId || bornaalId.length < 5) return null;
      const { data, error } = await supabase.rpc("lookup_by_bornaal_id", {
        p_bornaal_id: bornaalId,
      });
      if (error) throw error;
      const rows = data as BornaalUserProfile[];
      return rows?.[0] ?? null;
    },
    enabled: !!bornaalId && bornaalId.length >= 5,
  });

export const useSearchBornaalId = (prefix: string) =>
  useQuery({
    queryKey: ["bornaal-search", prefix],
    queryFn: async (): Promise<BornaalUserProfile[]> => {
      if (!prefix || prefix.length < 3) return [];
      const { data, error } = await supabase.rpc("search_bornaal_id", {
        p_prefix: prefix,
      });
      if (error) throw error;
      return (data ?? []) as BornaalUserProfile[];
    },
    enabled: !!prefix && prefix.length >= 3,
  });
