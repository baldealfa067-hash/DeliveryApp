import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const useBairros = () =>
  useQuery({
    queryKey: ["bairros"],
    queryFn: async () => {
      const { data, error } = await supabase.from("bairros").select("name").order("name");
      if (error) throw error;
      return (data ?? []).map((b) => b.name);
    },
  });
