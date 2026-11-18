import { useId, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadError } from "@/components/LoadError";
import { supabase } from "@/integrations/supabase/client";
import { formatCFA } from "@/lib/format";
import { LOCATION_OPTIONS } from "@/lib/locations";

export const IndependentDriverPrices = ({ driverId }: { driverId: string }) => {
  const { t } = useTranslation();
  const id = useId();
  const [bairro, setBairro] = useState("");
  const [customZone, setCustomZone] = useState(false);
  const [price, setPrice] = useState("");
  const prices = useQuery({
    queryKey: ["driver-zone-prices", driverId],
    queryFn: async () => {
      const { data, error } = await supabase.from("driver_zone_prices")
        .select("bairro, preco").eq("driver_id", driverId).order("bairro");
      if (error) throw error;
      return data;
    },
  });
  const save = useMutation({
    mutationFn: async (row: { bairro: string; preco: number }) => {
      const { error } = await supabase.from("driver_zone_prices")
        .upsert({ driver_id: driverId, ...row }, { onConflict: "driver_id,bairro" });
      if (error) throw error;
    },
    onSuccess: async () => {
      setBairro("");
      setCustomZone(false);
      setPrice("");
      await prices.refetch();
    },
    onError: () => toast.error(t("fleetDashboard.genericError")),
  });
  const remove = useMutation({
    mutationFn: async (zone: string) => {
      const { error } = await supabase.from("driver_zone_prices").delete().eq("driver_id", driverId).eq("bairro", zone);
      if (error) throw error;
    },
    onSuccess: () => prices.refetch(),
    onError: () => toast.error(t("fleetDashboard.genericError")),
  });

  const valid = !!bairro.trim() && !!price.trim() && Number.isFinite(Number(price)) && Number(price) >= 0 && Number(price) <= 9999999999.99;
  const busy = save.isPending || remove.isPending;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid && !busy) save.mutate({ bairro: bairro.trim(), preco: Number(price) });
  };

  if (prices.isError) return <LoadError onRetry={() => void prices.refetch()} />;
  if (prices.isLoading) return <p role="status">{t("common.loading")}</p>;

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor={`${id}-bairro`}>{t("fleetDashboard.bairro")}</Label>
            <Select value={customZone ? "__custom__" : bairro} onValueChange={(value) => {
              setCustomZone(value === "__custom__");
              setBairro(value === "__custom__" ? "" : value);
            }}>
              <SelectTrigger id={customZone ? undefined : `${id}-bairro`} className="h-11 bg-card"
                aria-label={customZone ? t("fleetDashboard.bairro") : undefined}>
                <SelectValue placeholder={t("common.select")} />
              </SelectTrigger>
              <SelectContent position="popper" side="bottom" sideOffset={6}
                className="max-h-64 min-w-[var(--radix-select-trigger-width)] border-border bg-card text-card-foreground shadow-lg">
                {LOCATION_OPTIONS.map((zone) => <SelectItem key={zone} value={zone}>{zone}</SelectItem>)}
                <SelectItem value="__custom__">{t("common.others")}</SelectItem>
              </SelectContent>
            </Select>
            {customZone && <Input id={`${id}-bairro`} maxLength={100} placeholder={t("fleetDashboard.bairro")}
              value={bairro} onChange={(event) => setBairro(event.target.value)} required />}
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-price`}>{t("fleetDashboard.priceFcfa")}</Label>
            <Input id={`${id}-price`} type="number" inputMode="decimal" min="0" max="9999999999.99" step="0.01"
              value={price} onChange={(event) => setPrice(event.target.value)} required />
          </div>
          <Button type="submit" disabled={!valid || busy}>{t("fleetDashboard.savePrice")}</Button>
        </form>
        {prices.data?.length ? (
          <ul className="divide-y">
            {prices.data.map((row) => (
              <li key={row.bairro} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div><p className="font-medium">{row.bairro}</p><p className="text-sm text-muted-foreground">{formatCFA(row.preco)}</p></div>
                <div className="flex gap-1">
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => {
                    setCustomZone(!LOCATION_OPTIONS.includes(row.bairro));
                    setBairro(row.bairro);
                    setPrice(String(row.preco));
                  }}>{t("driverDashboard.editZonePrice")}</Button>
                  <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => remove.mutate(row.bairro)}>
                    {t("common.remove")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted-foreground">{t("fleetDashboard.noPrices")}</p>}
      </CardContent>
    </Card>
  );
};

export const IndependentDriverFinance = ({ driverId }: { driverId: string }) => {
  const { t, i18n } = useTranslation();
  const finance = useQuery({
    queryKey: ["independent-driver-finance", driverId],
    queryFn: async () => {
      const [summary, movements] = await Promise.all([
        supabase.rpc("get_independent_driver_finance"),
        supabase.from("ledger_entries").select("id, entry_type, amount, base_amount, rate, created_at")
          .eq("driver_id", driverId).eq("account_kind", "driver").eq("counterparty", "platform")
          .order("created_at", { ascending: false }).limit(30),
      ]);
      if (summary.error) throw summary.error;
      if (movements.error) throw movements.error;
      return { summary: summary.data[0], movements: movements.data };
    },
  });
  if (finance.isError) return <LoadError onRetry={() => void finance.refetch()} />;
  if (finance.isLoading) return <p role="status">{t("common.loading")}</p>;
  if (!finance.data?.summary) return null;

  const { summary, movements } = finance.data;
  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap justify-between gap-4">
          <div><p className="text-sm text-muted-foreground">{t("driverDashboard.platformBalance")}</p><p className="text-xl font-bold">{formatCFA(Number(summary.saldo_plataforma))}</p></div>
          <div><p className="text-sm text-muted-foreground">{t("fleetDashboard.commissionGenerated")}</p><p className="font-semibold">{formatCFA(Number(summary.comissao_gerada))}</p></div>
        </div>
        <p className="text-sm">{t("driverDashboard.deliveryCommission", { rate: summary.taxa_actual })}</p>
        <h2 className="font-semibold">{t("driverDashboard.recentMovements")}</h2>
        {movements.length ? (
          <ul className="divide-y">
            {movements.map((movement) => (
              <li key={movement.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <p>{movement.entry_type === "comissao_motorista" ? t("driverDashboard.commissionEntry") : t("fleetDashboard.entry.reversao")}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(movement.created_at).toLocaleDateString(i18n.language === "kri" ? "pt" : i18n.language)}
                    {movement.base_amount != null && movement.rate != null && ` · ${formatCFA(Number(movement.base_amount))} × ${movement.rate}%`}
                  </p>
                </div>
                <p className="font-medium">{formatCFA(Number(movement.amount))}</p>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted-foreground">{t("driverDashboard.noFinanceMovements")}</p>}
      </CardContent>
    </Card>
  );
};
