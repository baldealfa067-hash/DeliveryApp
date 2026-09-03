import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ServiceRequest {
  id: string;
  category: string;
  description: string;
  location: string;
  status: string;
  created_at: string;
  requester_name: string | null;
  requester_phone: string | null;
  user_id: string | null;
  deadline: string | null;
  budget_type: string;
  budget_amount: number | null;
}

export const useRequests = () =>
  useQuery({
    queryKey: ["service_requests"],
    queryFn: async (): Promise<ServiceRequest[]> => {
      const { data, error } = await supabase
        .from("service_requests")
        .select("id, category, description, location, status, created_at, requester_name, requester_phone, user_id, deadline, budget_type, budget_amount")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ServiceRequest[];
    },
  });

export const useCreateRequest = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      category: string;
      description: string;
      location: string;
      requester_name: string;
      requester_phone: string;
      user_id?: string;
      deadline?: string | null;
      budget_type?: string;
      budget_amount?: number | null;
    }) => {
      const { error } = await supabase.from("service_requests").insert({
        category: payload.category,
        description: payload.description,
        location: payload.location,
        requester_name: payload.requester_name,
        requester_phone: payload.requester_phone,
        user_id: payload.user_id ?? null,
        deadline: payload.deadline ?? null,
        budget_type: payload.budget_type ?? "combinar",
        budget_amount: payload.budget_amount ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["service_requests"] }),
  });
};

export interface RequestBid {
  id: string;
  request_id: string;
  provider_id: string;
  message: string | null;
  status: string;
  created_at: string;
}

export interface RequestBidWithProvider extends RequestBid {
  provider: {
    id: string;
    name: string;
    phone: string;
    photo_url: string | null;
    is_verified: boolean;
    category: string;
  } | null;
}

export const useBidsForRequest = (requestId: string) =>
  useQuery({
    queryKey: ["request_bids", requestId],
    queryFn: async (): Promise<RequestBidWithProvider[]> => {
      const { data, error } = await supabase
        .from("request_bids")
        .select("*, provider:profiles!request_bids_provider_id_fkey(id, name, phone, photo_url, is_verified, category)")
        .eq("request_id", requestId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as RequestBidWithProvider[];
    },
    enabled: !!requestId,
  });

export const useBidOnRequest = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      request_id: string;
      provider_id: string;
      message?: string;
    }) => {
      const { error } = await supabase.from("request_bids").insert({
        request_id: payload.request_id,
        provider_id: payload.provider_id,
        message: payload.message ?? null,
      });
      if (error) throw error;
      // auto-close às 5 candidaturas é feito por trigger no servidor
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["request_bids"] });
      qc.invalidateQueries({ queryKey: ["service_requests"] });
    },
  });
};

export const useUpdateBidStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: string; status: "aceite" | "recusado" }) => {
      const { error } = await supabase
        .from("request_bids")
        .update({ status: payload.status })
        .eq("id", payload.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["request_bids"] }),
  });
};

export const useMyBidOnRequest = (requestId: string, providerId: string | null) =>
  useQuery({
    queryKey: ["my_bid", requestId, providerId],
    queryFn: async (): Promise<RequestBid | null> => {
      if (!providerId) return null;
      const { data, error } = await supabase
        .from("request_bids")
        .select("id, request_id, provider_id, message, status, created_at")
        .eq("request_id", requestId)
        .eq("provider_id", providerId)
        .maybeSingle();
      if (error) throw error;
      return data as RequestBid | null;
    },
    enabled: !!requestId && !!providerId,
  });

export const useMarkRequestCompleted = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabase.rpc("mark_request_completed", {
        p_request_id: requestId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["service_requests"] });
    },
  });
};

export const useSubmitReview = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      provider_id: string;
      request_id: string;
      rating: number;
      comment?: string | null;
      reviewer_name: string;
      user_id: string;
    }) => {
      const { error } = await supabase.from("reviews").insert({
        provider_id: payload.provider_id,
        request_id: payload.request_id,
        rating: payload.rating,
        comment: payload.comment ?? null,
        reviewer_name: payload.reviewer_name,
        user_id: payload.user_id,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["service_requests"] });
      qc.invalidateQueries({ queryKey: ["providers"] });
    },
  });
};