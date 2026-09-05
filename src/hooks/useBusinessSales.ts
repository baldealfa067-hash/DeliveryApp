import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface SalesStats {
  today_total: number;
  today_count: number;
  week_total: number;
  week_count: number;
  month_total: number;
  month_count: number;
  avg_ticket: number;
}

interface DailySales {
  day: string;
  total: number;
  order_count: number;
}

export const useBusinessSalesStats = (businessId: string | null) =>
  useQuery<SalesStats>({
    queryKey: ["business-sales-stats", businessId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_business_sales_stats", {
        p_business_id: businessId!,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return {
        today_total: Number(row?.today_total ?? 0),
        today_count: Number(row?.today_count ?? 0),
        week_total: Number(row?.week_total ?? 0),
        week_count: Number(row?.week_count ?? 0),
        month_total: Number(row?.month_total ?? 0),
        month_count: Number(row?.month_count ?? 0),
        avg_ticket: Number(row?.avg_ticket ?? 0),
      };
    },
    enabled: !!businessId,
    staleTime: 30_000,
  });

export const useBusinessDailySales = (businessId: string | null, days = 7) =>
  useQuery<DailySales[]>({
    queryKey: ["business-daily-sales", businessId, days],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_business_daily_sales", {
        p_business_id: businessId!,
        p_days: days,
      });
      if (error) throw error;
      return (data as DailySales[]) ?? [];
    },
    enabled: !!businessId,
    staleTime: 30_000,
  });
