import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useRestaurantTeamAccess(userId: string | undefined) {
  return useQuery({
    queryKey: ["my-restaurant-team-access", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_my_restaurant_team_access");
      if (error) throw error;
      return data[0] ?? null;
    },
    refetchInterval: 15000,
  });
}
