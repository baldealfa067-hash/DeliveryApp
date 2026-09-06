import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCFA } from "@/lib/format";
import { useBusinessCommission, useCommissionPayments } from "@/hooks/useCommission";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";

const COMPLETE_ORDER_STATUSES = ["pronto", "aguardando_motorista", "motorista_encontrado", "pedido_recolhido", "a_caminho", "entregue", "concluido"] as const;

const getPeriodDateRange = (period: "this_month" | "last_month" | "this_year" | "all"): Date => {
  const now = new Date();
  switch (period) {
    case "this_month":
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case "last_month":
      return new Date(now.getFullYear(), now.getMonth() - 1, 1);
    case "this_year":
      return new Date(now.getFullYear(), 0, 1);
    case "all":
      return new Date("2000-01-01");
  }
};

const isInPeriod = (date: Date, period: "this_month" | "last_month" | "this_year" | "all"): boolean => {
  const checkDate = new Date(date);
  const now = new Date();
  switch (period) {
    case "this_month":
      return checkDate.getFullYear() === now.getFullYear() && checkDate.getMonth() === now.getMonth();
    case "last_month": {
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1);
      return checkDate.getFullYear() === lastMonth.getFullYear() && checkDate.getMonth() === lastMonth.getMonth();
    }
    case "this_year":
      return checkDate.getFullYear() === now.getFullYear();
    case "all":
      return true;
  }
};

type PeriodFilter = "this_month" | "last_month" | "this_year" | "all";

interface Movement {
  id: string;
  date: string;
  type: "venda" | "pagamento";
  description: string;
  amount: number;
  status?: string;
  proofUrl?: string;
  note?: string;
}

interface CurrentAccountProps {
  businessId: string;
}

const BusinessCurrentAccount = ({ businessId }: CurrentAccountProps) => {
  const { t } = useTranslation();
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("this_month");
  const [expandedMovement, setExpandedMovement] = useState<string | null>(null);

  const { data: commission } = useBusinessCommission(businessId);
  const { data: commissionPayments = [] } = useCommissionPayments(businessId);

  // Fetch orders to calculate movement history
  const { data: orders = [] } = useQuery({
    queryKey: ["business-orders-history", businessId, periodFilter],
    queryFn: async () => {
      const startDate = getPeriodDateRange(periodFilter);

      const { data, error } = await supabase
        .from("orders")
        .select("id, total, status, created_at")
        .eq("business_id", businessId)
        .gte("created_at", startDate.toISOString())
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data || []) as Array<{ id: string; total: number; status: string; created_at: string }>;
    },
  });

  const movements = useMemo(() => {
    const items: Movement[] = [];

    // Add commission payment movements
    commissionPayments.forEach((cp) => {
      if (isInPeriod(new Date(cp.created_at), periodFilter)) {
        items.push({
          id: `payment-${cp.id}`,
          date: cp.created_at,
          type: "pagamento",
          description: t("currentAccount.commissionPayment"),
          amount: -cp.amount,
          status: cp.status,
          proofUrl: cp.proof_url,
          note: cp.note ?? undefined,
        });
      }
    });

    // Add order movements (sales)
    orders.forEach((order) => {
      if (COMPLETE_ORDER_STATUSES.includes(order.status as any)) {
        items.push({
          id: `order-${order.id}`,
          date: order.created_at,
          type: "venda",
          description: t("currentAccount.sale"),
          amount: order.total,
        });
      }
    });

    return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [commissionPayments, orders, periodFilter, t]);

  const filteredCommission = useMemo(() => {
    if (!commission) return null;

    // For filtered view, recalculate based on filtered orders
    const filteredSalesTotal = orders.filter((o) => COMPLETE_ORDER_STATUSES.includes(o.status as any)).reduce((sum, o) => sum + o.total, 0);

    const commissionDue = Math.round(filteredSalesTotal * commission.commission_rate / 100);
    const paidFiltered = commissionPayments.filter((cp) => isInPeriod(new Date(cp.created_at), periodFilter) && cp.status === "validado").reduce((sum, cp) => sum + cp.amount, 0);

    return {
      ...commission,
      total_sales: filteredSalesTotal,
      commission_due: commissionDue,
      commission_paid: paidFiltered,
      commission_balance: commissionDue - paidFiltered,
    };
  }, [commission, orders, commissionPayments, periodFilter]);

  if (!commission) {
    return (
      <Card>
        <CardContent className="p-4 text-center text-muted-foreground">
          {t("currentAccount.noData")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top 4 key metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-3 flex flex-col items-center gap-1">
            <span className="text-[10px] text-muted-foreground uppercase font-semibold">{t("currentAccount.totalSales")}</span>
            <span className="text-lg font-bold text-primary">{formatCFA(filteredCommission?.total_sales || 0)}</span>
          </CardContent>
        </Card>

        <Card className="border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950">
          <CardContent className="p-3 flex flex-col items-center gap-1">
            <span className="text-[10px] text-orange-700 dark:text-orange-300 uppercase font-semibold">{t("currentAccount.commissionGenerated")}</span>
            <span className="text-lg font-bold text-orange-600 dark:text-orange-400">{formatCFA(filteredCommission?.commission_due || 0)}</span>
          </CardContent>
        </Card>

        <Card className="border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950">
          <CardContent className="p-3 flex flex-col items-center gap-1">
            <span className="text-[10px] text-green-700 dark:text-green-300 uppercase font-semibold">{t("currentAccount.commissionPaid")}</span>
            <span className="text-lg font-bold text-green-600 dark:text-green-400">{formatCFA(filteredCommission?.commission_paid || 0)}</span>
          </CardContent>
        </Card>

        <Card className={`border-2 ${(filteredCommission?.commission_balance || 0) > 0 ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950" : "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950"}`}>
          <CardContent className="p-3 flex flex-col items-center gap-1">
            <span className={`text-[10px] uppercase font-semibold ${(filteredCommission?.commission_balance || 0) > 0 ? "text-red-700 dark:text-red-300" : "text-green-700 dark:text-green-300"}`}>
              {t("currentAccount.balance")}
            </span>
            <span className={`text-lg font-bold ${(filteredCommission?.commission_balance || 0) > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
              {formatCFA(filteredCommission?.commission_balance || 0)}
            </span>
          </CardContent>
        </Card>
      </div>

      {/* Period filter */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground uppercase font-semibold">{t("currentAccount.period")}</span>
            <div className="flex gap-2 flex-wrap">
              {(["this_month", "last_month", "this_year", "all"] as const).map((period) => (
                <Button
                  key={period}
                  variant={periodFilter === period ? "default" : "outline"}
                  size="sm"
                  className="text-xs"
                  onClick={() => setPeriodFilter(period)}
                >
                  {t(`currentAccount.period_${period}`)}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Statement/Extract */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("currentAccount.statement")}</p>

          {movements.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">{t("currentAccount.noMovements")}</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {movements.map((mov) => (
                <div
                  key={mov.id}
                  className="flex flex-col gap-2 p-3 rounded-lg border hover:bg-accent/50 transition-colors cursor-pointer"
                  onClick={() => setExpandedMovement(expandedMovement === mov.id ? null : mov.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{mov.description}</p>
                      <p className="text-xs text-muted-foreground">{new Date(mov.date).toLocaleString()}</p>
                    </div>
                    <div className="flex items-center gap-2 ml-2">
                      <div className="text-right">
                        <p className={`text-sm font-bold ${mov.amount > 0 ? "text-green-600" : "text-orange-600"}`}>
                          {mov.amount > 0 ? "+" : ""}{formatCFA(Math.abs(mov.amount))}
                        </p>
                        {mov.status && (
                          <Badge
                            variant="secondary"
                            className={`text-[10px] mt-1 ${
                              mov.status === "validado" ? "bg-green-100 text-green-700" :
                              mov.status === "rejeitado" ? "bg-red-100 text-red-700" :
                              "bg-yellow-100 text-yellow-700"
                            }`}
                          >
                            {t(`commission.status_${mov.status}`, mov.status)}
                          </Badge>
                        )}
                      </div>
                      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expandedMovement === mov.id ? "rotate-180" : ""}`} />
                    </div>
                  </div>

                  {/* Expanded details */}
                  {expandedMovement === mov.id && (
                    <div className="mt-2 pt-2 border-t space-y-2">
                      {mov.status === "rejeitado" && mov.note && (
                        <div className="bg-red-50 dark:bg-red-950 p-2 rounded-md">
                          <p className="text-xs font-semibold text-red-700 dark:text-red-300 mb-1">{t("currentAccount.rejectionReason")}</p>
                          <p className="text-xs text-red-600 dark:text-red-400">{mov.note}</p>
                        </div>
                      )}
                      {mov.proofUrl && (
                        <>
                          <p className="text-xs font-semibold text-muted-foreground">{t("currentAccount.proof")}</p>
                          <img src={mov.proofUrl} alt="Comprovativo" className="max-h-32 max-w-full object-contain rounded-md border cursor-pointer hover:opacity-90" />
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info text */}
      <p className="text-xs text-muted-foreground text-center">
        {t("currentAccount.info", { rate: commission.commission_rate })}
      </p>
    </div>
  );
};

export default BusinessCurrentAccount;
