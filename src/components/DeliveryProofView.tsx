import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Camera, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/**
 * A prova de entrega, para quem tem direito a vê-la (Fase 9.3, §37).
 *
 * Lê pela RPC `get_delivery_proof`, e não pela tabela, por duas razões: a frota
 * está fora da tabela por decisão de 2026-09-10, e a RPC já decide qual das
 * provas mostrar quando há várias (código validado vale mais do que foto).
 *
 * Não mostra nada enquanto não há prova — não é um estado de erro, é só uma
 * entrega que ainda não acabou.
 */
const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string, args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

interface Prova {
  existe: boolean;
  tipo?: "codigo" | "foto";
  foto?: string | null;
  registada_em?: string;
}

export const DeliveryProofView = ({ orderId }: { orderId: string }) => {
  const { t } = useTranslation();
  const { data } = useQuery({
    queryKey: ["prova-entrega", orderId],
    queryFn: async () => {
      const { data, error } = await rpc("get_delivery_proof", { p_order_id: orderId });
      if (error) throw new Error(error.message);
      return data as Prova;
    },
  });

  if (!data?.existe) return null;

  const quando = data.registada_em
    ? new Date(data.registada_em).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
    : null;

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
      <p className="text-xs font-semibold uppercase text-muted-foreground">{t("orderTracking.proofTitle")}</p>
      <div className="flex items-center gap-2 text-sm">
        {data.tipo === "codigo"
          ? <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
          : <Camera className="h-4 w-4 text-primary shrink-0" />}
        <span className="flex-1">
          {data.tipo === "codigo" ? t("orderTracking.proofByCode") : t("orderTracking.proofByPhoto")}
        </span>
        {quando && <span className="text-xs text-muted-foreground whitespace-nowrap">{quando}</span>}
      </div>
      {data.tipo === "foto" && data.foto && (
        <img src={data.foto} alt={t("orderTracking.proofByPhoto")} loading="lazy"
          className="w-full max-h-64 rounded-md object-cover" />
      )}
    </div>
  );
};
