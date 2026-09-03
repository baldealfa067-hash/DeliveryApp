import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Proposal {
  id: string;
  provider_id: string;
  title: string;
  category: string;
  description: string;
  price: number;
  price_type: "fixo" | "desde";
  location: string;
  status: "ativa" | "pausada";
  created_at: string;
}

export interface ProposalWithProvider extends Proposal {
  provider: {
    id: string;
    name: string;
    phone: string;
    photo_url: string | null;
    is_verified: boolean;
  } | null;
  avgRating: number;
  reviewCount: number;
}

export const useProposals = (category?: string) =>
  useQuery({
    queryKey: ["proposals", category],
    queryFn: async (): Promise<ProposalWithProvider[]> => {
      let q = supabase
        .from("proposals")
        .select("*, provider:profiles!proposals_provider_id_fkey(id, name, phone, photo_url, is_verified)")
        .eq("status", "ativa")
        .order("created_at", { ascending: false });
      if (category) q = q.eq("category", category);
      const { data, error } = await q;
      if (error) throw error;
      const items = (data ?? []) as (Proposal & {
        provider: ProposalWithProvider["provider"];
      })[];
      const providerIds = items.map((i) => i.provider_id);
      const { data: reviews } = await supabase
        .from("reviews")
        .select("provider_id, rating")
        .in("provider_id", providerIds.length ? providerIds : ["__none__"]);
      return items.map((p) => {
        const r = (reviews ?? []).filter((x) => x.provider_id === p.provider_id).map((x) => x.rating);
        return {
          ...p,
          avgRating: r.length ? r.reduce((a, b) => a + b, 0) / r.length : 0,
          reviewCount: r.length,
        } as ProposalWithProvider;
      });
    },
  });

export const useMyProposals = (providerId: string | null) =>
  useQuery({
    queryKey: ["my-proposals", providerId],
    queryFn: async (): Promise<Proposal[]> => {
      if (!providerId) return [];
      const { data, error } = await supabase
        .from("proposals")
        .select("*")
        .eq("provider_id", providerId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Proposal[];
    },
    enabled: !!providerId,
  });

export const useSaveProposal = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<Proposal> & { provider_id: string }) => {
      if (payload.id) {
        const { id, ...rest } = payload;
        const { error } = await supabase.from("proposals").update(rest).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("proposals").insert(payload as never);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["proposals"] });
      qc.invalidateQueries({ queryKey: ["my-proposals"] });
    },
  });
};

export const useDeleteProposal = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("proposals").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["proposals"] });
      qc.invalidateQueries({ queryKey: ["my-proposals"] });
    },
  });
};