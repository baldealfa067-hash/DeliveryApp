import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";

export function DeliveryConfirmationCode({ orderId, manual = false }: { orderId: string; manual?: boolean }) {
  const { t } = useTranslation();
  const code = useQuery({
    queryKey: ["delivery-confirmation-pin", orderId, manual],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_delivery_confirmation_pin", { p_order_id: orderId });
      if (error) throw error;
      return data;
    },
    gcTime: 0,
  });

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-2">
      <h2 className="text-sm font-semibold">{t("deliveryConfirmation.title")}</h2>
      {code.data && <p className="font-mono text-3xl font-bold tracking-[0.25em]">{code.data}</p>}
      {code.isPending && <p role="status" className="text-sm">{t("common.loading")}</p>}
      {code.isError && <button type="button" className="text-sm underline" onClick={() => void code.refetch()}>{t("common.tryAgain")}</button>}
      <p className="text-sm">{t(manual ? "deliveryConfirmation.manualHint" : "deliveryConfirmation.customerHint")}</p>
    </div>
  );
}
