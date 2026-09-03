import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Driver {
  id: string;
  user_id: string;
  name: string;
  phone: string;
  vehicle_type: string;
  is_available: boolean;
  current_lat: number | null;
  current_lng: number | null;
  created_at: string;
}

export interface Delivery {
  id: string;
  order_id: string;
  order_number?: number;
  restaurant_name?: string;
  restaurant_phone?: string;
  restaurant_address?: string;
  customer_name?: string;
  customer_phone?: string;
  customer_address?: string;
  distance_km: number | null;
  delivery_fee: number;
  status: string;
  accepted_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  created_at: string;
}

export interface AvailableDelivery {
  id: string;
  order_id: string;
  restaurant_name: string;
  restaurant_address: string | null;
  customer_address: string | null;
  distance_km: number | null;
  delivery_fee: number;
  created_at: string;
}

export interface TrackingPoint {
  lat: number;
  lng: number;
  status: string;
  created_at: string;
}

export const useRegisterDriver = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { name: string; phone: string; vehicleType?: string }) => {
      const { data, error } = await supabase.rpc("register_as_driver", {
        p_name: params.name,
        p_phone: params.phone,
        p_vehicle_type: params.vehicleType ?? "moto",
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["driver"] });
    },
  });
};

export const useDriverProfile = (userId: string | null) =>
  useQuery({
    queryKey: ["driver", userId],
    queryFn: async (): Promise<Driver | null> => {
      if (!userId) return null;
      const { data, error } = await supabase
        .from("drivers")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return data as Driver | null;
    },
    enabled: !!userId,
  });

export const useToggleAvailability = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("toggle_driver_availability");
      if (error) throw error;
      return data as boolean;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["driver"] });
    },
  });
};

export const useUpdateDriverLocation = () =>
  useMutation({
    mutationFn: async (params: { lat: number; lng: number }) => {
      const { error } = await supabase.rpc("update_driver_location", {
        p_lat: params.lat,
        p_lng: params.lng,
      });
      if (error) throw error;
    },
  });

export const useAvailableDeliveries = () =>
  useQuery({
    queryKey: ["available-deliveries"],
    queryFn: async (): Promise<AvailableDelivery[]> => {
      const { data, error } = await supabase.rpc("get_available_deliveries");
      if (error) throw error;
      return (data ?? []) as AvailableDelivery[];
    },
    refetchInterval: 5000,
  });

export const useMyDeliveries = () =>
  useQuery({
    queryKey: ["my-deliveries"],
    queryFn: async (): Promise<Delivery[]> => {
      const { data, error } = await supabase.rpc("get_my_deliveries");
      if (error) throw error;
      return (data ?? []) as Delivery[];
    },
    refetchInterval: 5000,
  });

export const useAcceptDelivery = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (deliveryId: string) => {
      const { error } = await supabase.rpc("accept_delivery", {
        p_delivery_id: deliveryId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["available-deliveries"] });
      qc.invalidateQueries({ queryKey: ["my-deliveries"] });
    },
  });
};

export const usePickupDelivery = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (deliveryId: string) => {
      const { error } = await supabase.rpc("pickup_delivery", {
        p_delivery_id: deliveryId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-deliveries"] });
    },
  });
};

export const useCompleteDelivery = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (deliveryId: string) => {
      const { error } = await supabase.rpc("complete_delivery", {
        p_delivery_id: deliveryId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-deliveries"] });
    },
  });
};

export const useCreateDelivery = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      orderId: string;
      restaurantLat: number;
      restaurantLng: number;
      restaurantAddress: string;
      customerLat: number;
      customerLng: number;
      customerAddress: string;
      distanceKm?: number;
    }) => {
      const { data, error } = await supabase.rpc("create_delivery", {
        p_order_id: params.orderId,
        p_restaurant_lat: params.restaurantLat,
        p_restaurant_lng: params.restaurantLng,
        p_restaurant_address: params.restaurantAddress,
        p_customer_lat: params.customerLat,
        p_customer_lng: params.customerLng,
        p_customer_address: params.customerAddress,
        p_distance_km: params.distanceKm ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["delivery-orders"] });
    },
  });
};

export const useDeliveryTracking = (deliveryId: string | null) =>
  useQuery({
    queryKey: ["delivery-tracking", deliveryId],
    queryFn: async (): Promise<TrackingPoint[]> => {
      if (!deliveryId) return [];
      const { data, error } = await supabase.rpc("get_delivery_tracking", {
        p_delivery_id: deliveryId,
      });
      if (error) throw error;
      return (data ?? []) as TrackingPoint[];
    },
    enabled: !!deliveryId,
    refetchInterval: 3000,
  });

export interface DeliveryProof {
  id: string;
  delivery_id: string;
  order_id: string;
  driver_id: string;
  photo_url: string | null;
  qr_validated: boolean;
  validated_at: string | null;
  created_at: string;
}

export const useCreateDeliveryProof = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      deliveryId: string;
      photoUrl: string;
      qrValidated?: boolean;
    }) => {
      const { data, error } = await supabase.rpc("create_delivery_proof", {
        p_delivery_id: params.deliveryId,
        p_photo_url: params.photoUrl,
        p_qr_validated: params.qrValidated ?? false,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-deliveries"] });
      qc.invalidateQueries({ queryKey: ["delivery-proofs"] });
    },
  });
};

export const useValidateDeliveryQR = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { deliveryId: string; orderId: string }) => {
      const { data, error } = await supabase.rpc("validate_delivery_qr", {
        p_delivery_id: params.deliveryId,
        p_order_id: params.orderId,
      });
      if (error) throw error;
      return data as boolean;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-deliveries"] });
      qc.invalidateQueries({ queryKey: ["delivery-proofs"] });
    },
  });
};

export const useUpdateDeliveryTracking = () =>
  useMutation({
    mutationFn: async (params: {
      deliveryId: string;
      lat: number;
      lng: number;
      status?: string;
    }) => {
      const { error } = await supabase.rpc("update_delivery_tracking", {
        p_delivery_id: params.deliveryId,
        p_lat: params.lat,
        p_lng: params.lng,
        p_status: params.status ?? "em_movimento",
      });
      if (error) throw error;
    },
  });
