import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface DriverStats {
  today_count: number;
  today_distance: number;
  today_earnings: number;
  week_count: number;
  week_distance: number;
  week_earnings: number;
  month_count: number;
  month_distance: number;
  month_earnings: number;
}

interface DailyDriverStats {
  day: string;
  delivery_count: number;
  distance: number;
}

export const useDriverDeliveryStats = (driverId: string | null) =>
  useQuery<DriverStats>({
    queryKey: ["driver-delivery-stats", driverId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_driver_delivery_stats", {
        p_driver_id: driverId!,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      // Number(...) em tudo de proposito: numeric do Postgres chega como string
      // no JSON, e somar strings dava concatenacao silenciosa.
      return {
        today_count: Number(row?.today_count ?? 0),
        today_distance: Number(row?.today_distance ?? 0),
        today_earnings: Number(row?.today_earnings ?? 0),
        week_count: Number(row?.week_count ?? 0),
        week_distance: Number(row?.week_distance ?? 0),
        week_earnings: Number(row?.week_earnings ?? 0),
        month_count: Number(row?.month_count ?? 0),
        month_distance: Number(row?.month_distance ?? 0),
        month_earnings: Number(row?.month_earnings ?? 0),
      };
    },
    enabled: !!driverId,
    staleTime: 30_000,
  });

export const useDriverDailyStats = (driverId: string | null, days = 7) =>
  useQuery<DailyDriverStats[]>({
    queryKey: ["driver-daily-stats", driverId, days],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_driver_daily_stats", {
        p_driver_id: driverId!,
        p_days: days,
      });
      if (error) throw error;
      return (data as DailyDriverStats[]) ?? [];
    },
    enabled: !!driverId,
    staleTime: 30_000,
  });
