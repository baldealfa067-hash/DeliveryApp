import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Appointment {
  id: string;
  business_id?: string;
  business_name?: string;
  customer_id?: string;
  customer_name: string;
  customer_phone: string;
  service_name: string;
  service_price: number | null;
  appointment_date: string;
  appointment_time: string;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export const useCreateAppointment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      businessId: string;
      customerId: string | null;
      customerName: string;
      customerPhone: string;
      serviceName: string;
      servicePrice: number | null;
      appointmentDate: string;
      appointmentTime: string;
      notes?: string;
    }) => {
      const { data, error } = await supabase.rpc("create_appointment", {
        p_business_id: params.businessId,
        p_customer_id: params.customerId,
        p_customer_name: params.customerName,
        p_customer_phone: params.customerPhone,
        p_service_name: params.serviceName,
        p_service_price: params.servicePrice,
        p_appointment_date: params.appointmentDate,
        p_appointment_time: params.appointmentTime,
        p_notes: params.notes ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["business-appointments", variables.businessId] });
      qc.invalidateQueries({ queryKey: ["customer-appointments", variables.customerId] });
    },
  });
};

export const useBusinessAppointments = (businessId: string | null, status?: string) =>
  useQuery({
    queryKey: ["business-appointments", businessId, status],
    queryFn: async (): Promise<Appointment[]> => {
      if (!businessId) return [];
      const { data, error } = await supabase.rpc("get_business_appointments", {
        p_business_id: businessId,
        p_status: status ?? null,
      });
      if (error) throw error;
      return (data ?? []) as Appointment[];
    },
    enabled: !!businessId,
    refetchInterval: 10000,
  });

export const useCustomerAppointments = (customerId: string | null) =>
  useQuery({
    queryKey: ["customer-appointments", customerId],
    queryFn: async (): Promise<Appointment[]> => {
      if (!customerId) return [];
      const { data, error } = await supabase.rpc("get_customer_appointments", {
        p_customer_id: customerId,
      });
      if (error) throw error;
      return (data ?? []) as Appointment[];
    },
    enabled: !!customerId,
    refetchInterval: 10000,
  });

export const useUpdateAppointmentStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      appointmentId: string;
      newStatus: string;
      note?: string;
    }) => {
      const { error } = await supabase.rpc("update_appointment_status", {
        p_appointment_id: params.appointmentId,
        p_new_status: params.newStatus,
        p_note: params.note ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["business-appointments"] });
      qc.invalidateQueries({ queryKey: ["customer-appointments"] });
    },
  });
};
