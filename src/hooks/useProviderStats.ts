import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ProviderStats {
  profile_views: number;
  whatsapp_clicks: number;
  call_clicks: number;
}

export interface ProviderActivity {
  id: string;
  provider_id: string;
  activity_type: "vista" | "whatsapp" | "call";
  created_at: string;
}

export const useProviderStatsQuery = (providerId: string | null) =>
  useQuery({
    queryKey: ["provider-stats", providerId],
    queryFn: async (): Promise<ProviderStats> => {
      if (!providerId) return { profile_views: 0, whatsapp_clicks: 0, call_clicks: 0 };
      const { data } = await supabase
        .from("provider_stats")
        .select("profile_views, whatsapp_clicks, call_clicks")
        .eq("provider_id", providerId)
        .maybeSingle();
      return {
        profile_views: data?.profile_views ?? 0,
        whatsapp_clicks: data?.whatsapp_clicks ?? 0,
        call_clicks: data?.call_clicks ?? 0,
      };
    },
    enabled: !!providerId,
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
    staleTime: 0,
  });

export const useProviderActivity = (providerId: string | null) =>
  useQuery({
    queryKey: ["provider-activity", providerId],
    queryFn: async (): Promise<ProviderActivity[]> => {
      if (!providerId) return [];
      const { data, error } = await supabase
        .from("provider_activity")
        .select("id, provider_id, activity_type, created_at")
        .eq("provider_id", providerId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as ProviderActivity[];
    },
    enabled: !!providerId,
  });

export const useProviderActivityRealtime = (providerId: string | null) => {
  const qc = useQueryClient();
  useEffect(() => {
    if (!providerId) return;
    const channel = supabase
      .channel(`provider-activity-${providerId}-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "provider_activity",
          filter: `provider_id=eq.${providerId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["provider-activity", providerId] });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [providerId, qc]);
};

export const useCommentCount = (providerId: string | null) =>
  useQuery({
    queryKey: ["review-count", providerId],
    queryFn: async (): Promise<number> => {
      if (!providerId) return 0;
      const { count } = await supabase
        .from("reviews")
        .select("id", { count: "exact", head: true })
        .eq("provider_id", providerId);
      return count ?? 0;
    },
    enabled: !!providerId,
    refetchInterval: 15000,
  });

export const useCommentCountRealtime = (providerId: string | null) => {
  const qc = useQueryClient();
  useEffect(() => {
    if (!providerId) return;
    const channel = supabase
      .channel(`reviews-${providerId}-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reviews", filter: `provider_id=eq.${providerId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["review-count", providerId] });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [providerId, qc]);
};

export const useQualityLevel = (providerId: string | null) =>
  useQuery({
    queryKey: ["quality-level", providerId],
    queryFn: async (): Promise<string | null> => {
      if (!providerId) return null;
      const { data } = await supabase
        .from("quality_levels")
        .select("level")
        .eq("provider_id", providerId)
        .maybeSingle();
      return data?.level ?? null;
    },
    enabled: !!providerId,
    refetchInterval: 15000,
  });

export const useQualityLevelRealtime = (providerId: string | null) => {
  const qc = useQueryClient();
  useEffect(() => {
    if (!providerId) return;
    const channel = supabase
      .channel(`quality-${providerId}-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "quality_levels", filter: `provider_id=eq.${providerId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["quality-level", providerId] });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [providerId, qc]);
};
