import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Order {
  id: string;
  order_number: number;
  customer_id?: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  business_id: string;
  business_name?: string;
  items: Array<{ name: string; price: number; qty: number }>;
  total: number;
  status: string;
  consumption_option: string;
  address: string | null;
  notes: string | null;
  preparation_time: number | null;
  created_at: string;
  updated_at: string;
  bairro: string | null;
}

export interface OrderHistoryEntry {
  status: string;
  note: string | null;
  created_at: string;
}

export const useCreateOrder = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      businessId: string;
      customerId: string | null;
      customerName: string;
      customerPhone: string;
      items: Array<{ name: string; price: number; qty: number }>;
      total: number;
      consumptionOption: string;
      address?: string;
      notes?: string;
      bairro?: string;
    }) => {
      const { data, error } = await supabase.rpc("create_order", {
        p_business_id: params.businessId,
        p_customer_id: params.customerId,
        p_customer_name: params.customerName,
        p_customer_phone: params.customerPhone,
        p_items: params.items as unknown as Record<string, unknown>[],
        p_total: params.total,
        p_consumption_option: params.consumptionOption,
        p_address: params.address ?? null,
        p_notes: params.notes ?? null,
        p_bairro: params.bairro ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["business-orders", variables.businessId] });
      qc.invalidateQueries({ queryKey: ["customer-orders", variables.customerId] });
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
  });
};

export const useBusinessOrders = (businessId: string | null, status?: string) =>
  useQuery({
    queryKey: ["business-orders", businessId, status],
    queryFn: async (): Promise<Order[]> => {
      if (!businessId) return [];
      const { data, error } = await supabase.rpc("get_business_orders", {
        p_business_id: businessId,
        p_status: status ?? null,
      });
      if (error) throw error;
      return (data ?? []) as Order[];
    },
    enabled: !!businessId,
    refetchInterval: 10000,
  });

export const useCustomerOrders = (customerId: string | null) =>
  useQuery({
    queryKey: ["customer-orders", customerId],
    queryFn: async (): Promise<Order[]> => {
      if (!customerId) return [];
      const { data, error } = await supabase.rpc("get_customer_orders", {
        p_customer_id: customerId,
      });
      if (error) throw error;
      return (data ?? []) as Order[];
    },
    enabled: !!customerId,
    refetchInterval: 10000,
  });

export const useUpdateOrderStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      orderId: string;
      newStatus: string;
      note?: string;
      preparationTime?: number;
    }) => {
      const { error } = await supabase.rpc("update_order_status", {
        p_order_id: params.orderId,
        p_new_status: params.newStatus,
        p_note: params.note ?? null,
        p_preparation_time: params.preparationTime ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["business-orders"] });
      qc.invalidateQueries({ queryKey: ["customer-orders"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
  });
};

export const useOrderHistory = (orderId: string | null) =>
  useQuery({
    queryKey: ["order-history", orderId],
    queryFn: async (): Promise<OrderHistoryEntry[]> => {
      if (!orderId) return [];
      const { data, error } = await supabase.rpc("get_order_history", {
        p_order_id: orderId,
      });
      if (error) throw error;
      return (data ?? []) as OrderHistoryEntry[];
    },
    enabled: !!orderId,
  });
