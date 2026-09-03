import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const useReportUser = () =>
  useMutation({
    mutationFn: async ({
      reporterId,
      reportedId,
      reason,
      description,
    }: {
      reporterId: string;
      reportedId: string;
      reason: string;
      description?: string;
    }) => {
      const { error } = await supabase.from("user_reports").insert({
        reporter_id: reporterId,
        reported_id: reportedId,
        reason,
        description: description ?? null,
      });
      if (error) throw error;
    },
  });
