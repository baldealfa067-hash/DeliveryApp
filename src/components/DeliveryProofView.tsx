import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Camera } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const DeliveryProofView = ({ orderId, stage = "delivery" }: { orderId: string; stage?: "pickup" | "delivery" }) => {
  const { t } = useTranslation();
  const { data } = useQuery({
    queryKey: ["prova-entrega", orderId, stage],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_order_photo_proof", { p_order_id: orderId, p_stage: stage });
      if (error) throw new Error(error.message);
      if (!data || typeof data !== "object" || Array.isArray(data) || data.existe !== true) return null;
      return {
        foto: typeof data.foto === "string" ? data.foto : null,
        registada_em: typeof data.registada_em === "string" ? data.registada_em : null,
      };
    },
  });

  if (!data) return null;

  const quando = data.registada_em
    ? new Date(data.registada_em).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
    : null;

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
      <p className="text-xs font-semibold uppercase text-muted-foreground">{t(stage === "pickup" ? "orderTracking.pickupProofTitle" : "orderTracking.proofTitle")}</p>
      <div className="flex items-center gap-2 text-sm">
        <Camera className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="flex-1">{t("orderTracking.proofByPhoto")}</span>
        {quando && <span className="text-xs text-muted-foreground whitespace-nowrap">{quando}</span>}
      </div>
      {data.foto && (
        <img src={data.foto} alt={t("orderTracking.proofByPhoto")} loading="lazy"
          className="w-full max-h-64 rounded-md object-cover" />
      )}
    </div>
  );
};
