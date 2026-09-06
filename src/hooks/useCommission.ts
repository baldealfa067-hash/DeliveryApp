import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CommissionSummary {
  total_sales: number;
  commission_rate: number;
  commission_due: number;
  commission_paid: number;
  commission_balance: number;
}

export interface CommissionPayment {
  id: string;
  business_id: string;
  amount: number;
  proof_url: string;
  status: string;
  note: string | null;
  created_at: string;
  validated_at: string | null;
  validated_by: string | null;
}

export interface AllCommissionEntry {
  business_id: string;
  business_name: string;
  total_sales: number;
  commission_due: number;
  commission_paid: number;
  commission_balance: number;
}

export const useBusinessCommission = (businessId: string | null) =>
  useQuery({
    queryKey: ["business-commission", businessId],
    queryFn: async (): Promise<CommissionSummary | null> => {
      if (!businessId) return null;
      const { data, error } = await supabase.rpc("get_business_commission", {
        p_business_id: businessId,
      });
      if (error) throw error;
      const rows = data as unknown as CommissionSummary[];
      return rows?.[0] ?? null;
    },
    enabled: !!businessId,
  });

export const useCommissionPayments = (businessId: string | null) =>
  useQuery({
    queryKey: ["commission-payments", businessId],
    queryFn: async (): Promise<CommissionPayment[]> => {
      if (!businessId) return [];
      const { data, error } = await supabase
        .from("commission_payments")
        .select("*")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CommissionPayment[];
    },
    enabled: !!businessId,
  });

export const useCreateCommissionPayment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { businessId: string; amount: number; proofUrl: string }) => {
      const { error } = await supabase.from("commission_payments").insert({
        business_id: params.businessId,
        amount: params.amount,
        proof_url: params.proofUrl,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["commission-payments", variables.businessId] });
      qc.invalidateQueries({ queryKey: ["business-commission", variables.businessId] });
    },
  });
};

export const useAllCommissions = () =>
  useQuery({
    queryKey: ["all-commissions"],
    queryFn: async (): Promise<AllCommissionEntry[]> => {
      const { data, error } = await supabase.rpc("get_all_commissions");
      if (error) throw error;
      return (data ?? []) as AllCommissionEntry[];
    },
  });

export const useAllCommissionPayments = () =>
  useQuery({
    queryKey: ["all-commission-payments"],
    queryFn: async (): Promise<(CommissionPayment & { business_name?: string })[]> => {
      const { data, error } = await supabase
        .from("commission_payments")
        .select("*, profiles!commission_payments_business_id_fkey(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown[]).map((row: unknown) => {
        const r = row as Record<string, unknown>;
        const profiles = r.profiles as { name: string } | null;
        return { ...r, business_name: profiles?.name ?? "" } as CommissionPayment & { business_name?: string };
      });
    },
  });

export const useValidateCommissionPayment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { id: string; status: "validado" | "rejeitado"; reason?: string }) => {
      const { error } = await supabase.rpc("validate_commission_payment", {
        p_id: params.id,
        p_status: params.status,
        p_note: params.status === "rejeitado" ? params.reason : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["all-commissions"] });
      qc.invalidateQueries({ queryKey: ["all-commission-payments"] });
      qc.invalidateQueries({ queryKey: ["commission-payments"] });
      qc.invalidateQueries({ queryKey: ["business-commission"] });
    },
  });
};

export const usePlatformSettings = () =>
  useQuery({
    queryKey: ["platform-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_settings")
        .select("key, value");
      if (error) throw error;
      const map: Record<string, string> = {};
      (data ?? []).forEach((r: { key: string; value: string }) => { map[r.key] = r.value; });
      return map;
    },
  });

export const useUpdatePlatformSetting = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { key: string; value: string }) => {
      const { error } = await supabase.rpc("update_platform_setting", {
        p_key: params.key,
        p_value: params.value,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["platform-settings"] });
      qc.invalidateQueries({ queryKey: ["all-commissions"] });
      qc.invalidateQueries({ queryKey: ["business-commission"] });
    },
  });
};
