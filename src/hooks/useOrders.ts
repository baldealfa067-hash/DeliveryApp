import type { Json } from "@/integrations/supabase/types";
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
  items: Array<{ menu_item_id?: string | null; name: string; price: number; qty: number }>;
  total: number;
  /** Taxa de entrega congelada no checkout. `null` em pedidos anteriores à
   *  Fase 3 e em bairros que nenhuma frota serve. `total` é só a comida. */
  delivery_fee: number | null;
  status: string;
  consumption_option: string;
  address: string | null;
  notes: string | null;
  preparation_time: number | null;
  created_at: string;
  updated_at: string;
  bairro: string | null;
  delivery_code: string | null;
  voice_note_url: string | null;
  payment_method: string;
  payment_proof_url: string | null;
  payment_status: string;
  /** Fase 2.4 — "app" (cliente na aplicação) ou "manual" (telefone/balcão). */
  source?: string | null;
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
      /**
       * FASE 2.0: `menu_item_id` e o que liga a linha ao menu. Sem ele o
       * servidor tem de adivinhar o artigo pelo nome, e o stock da 2.1 nao
       * tem de que linha descontar. O carrinho ja tinha o id — era so nao o
       * deitar fora a caminho do servidor.
       */
      items: Array<{ menu_item_id: string; name: string; price: number; qty: number }>;
      /**
       * Enviado apenas para CONFERENCIA. O total gravado e o que o servidor
       * calcula a partir de `menu_items` (§46); se este nao bater, o pedido e
       * recusado em vez de aceite por outro valor (§83).
       */
      total: number;
      consumptionOption: string;
      address?: string;
      notes?: string;
      bairro?: string;
      customerLat?: number;
      customerLng?: number;
      voiceNoteUrl?: string;
      paymentMethod?: string;
      paymentProofUrl?: string;
    }) => {
      const { data, error } = await supabase.rpc("create_order", {
        p_business_id: params.businessId,
        p_customer_id: params.customerId,
        p_customer_name: params.customerName,
        p_customer_phone: params.customerPhone,
        p_items: params.items as unknown as Json,
        p_total: params.total,
        p_consumption_option: params.consumptionOption,
        p_address: params.address ?? null,
        p_notes: params.notes ?? null,
        p_bairro: params.bairro ?? null,
        p_customer_lat: params.customerLat ?? null,
        p_customer_lng: params.customerLng ?? null,
        p_voice_note_url: params.voiceNoteUrl ?? null,
        p_payment_method: params.paymentMethod ?? "entrega",
        p_payment_proof_url: params.paymentProofUrl ?? null,
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

// Volta a oferecer aos motoristas da MESMA frota uma entrega que ninguem
// aceitou (Fase 5). Nao troca de frota: a frota e a taxa congelaram no checkout
// e o cliente aceitou aquele preco (§83).
//
// O servidor e' que decide se pode -- dono do restaurante do pedido ou admin, e
// so' enquanto a entrega nao tem motorista. Aqui nao se repete essa regra, so'
// se mostra o erro que ele devolver.
export const useReofferDelivery = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string) => {
      const { data, error } = await supabase.rpc("reoffer_delivery", {
        p_order_id: orderId,
      });
      if (error) throw error;
      return data as { ronda: number; motoristas_notificados: number };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["business-orders"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
  });
};

export const useValidateOrderPayment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { orderId: string; status: string }) => {
      const { error } = await supabase.rpc("validate_order_payment", {
        p_order_id: params.orderId,
        p_status: params.status,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["business-orders"] });
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
