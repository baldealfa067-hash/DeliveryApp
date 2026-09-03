import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const useMyProvider = (userId: string | null) =>
  useQuery({
    queryKey: ["my-provider", userId],
    queryFn: async () => {
      if (!userId) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("id, name, phone")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; name: string; phone: string } | null;
    },
    enabled: !!userId,
  });
