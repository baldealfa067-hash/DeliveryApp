import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Clock, Copy, Loader2, Plus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

/**
 * Horário de funcionamento (Fase 2.5).
 *
 * A UI permite VÁRIOS períodos por dia porque o backend permite, e uma UI com
 * um só par abre/fecha apagaria em silêncio o segundo turno de quem já o tivesse
 * gravado — gravar substitui a semana inteira. Almoço e jantar separados são o
 * caso normal, não a excepção.
 *
 * O interruptor "a aceitar pedidos" é outra coisa e está à parte de propósito:
 * um fecha por rotina, o outro por excepção (acabou o peixe). Juntá-los obrigava
 * o dono a editar o horário para fechar meia hora, e depois a lembrar-se de o
 * repor.
 */
interface Periodo { weekday: number; opens_at: string; closes_at: string }

const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string, args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export const BusinessHoursEditor = ({ businessId }: { businessId: string }) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  // Os nomes dos dias vivem no i18n e sao indexados por `weekday` (0 = domingo),
  // que e o que o backend guarda — nao pela ordem em que aparecem no ecra.
  const DIAS = t("businessHours.days", { returnObjects: true }) as string[];
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [aceita, setAceita] = useState(true);

  const { data, isLoading } = useQuery({
    queryKey: ["horarios", businessId],
    queryFn: async () => {
      const { data, error } = await rpc("get_business_hours", { p_business_id: businessId });
      if (error) throw new Error(error.message);
      return data as {
        aberto_agora: boolean; aceita_pedidos: boolean; periodos: Periodo[];
      };
    },
  });

  useEffect(() => {
    if (data) { setPeriodos(data.periodos ?? []); setAceita(data.aceita_pedidos); }
  }, [data]);

  const gravar = useMutation({
    mutationFn: async () => {
      for (const p of periodos) {
        if (p.opens_at === p.closes_at) {
          throw new Error(t("businessHours.sameHour", { day: DIAS[p.weekday] }));
        }
      }
      const { error } = await rpc("set_business_hours", {
        p_business_id: businessId, p_horario: periodos,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["horarios", businessId] });
      toast.success(t("businessHours.saved"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const alternarAceitar = useMutation({
    mutationFn: async (v: boolean) => {
      const { error } = await rpc("set_accepting_orders", {
        p_business_id: businessId, p_aceitar: v,
      });
      if (error) throw new Error(error.message);
      return v;
    },
    onSuccess: (v) => {
      setAceita(v);
      qc.invalidateQueries({ queryKey: ["horarios", businessId] });
      toast.success(t(v ? "businessHours.acceptingOn" : "businessHours.acceptingOff"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const doDia = (d: number) => periodos.filter((p) => p.weekday === d);
  const mudar = (d: number, i: number, campo: "opens_at" | "closes_at", v: string) =>
    setPeriodos((ps) => {
      const doDiaIdx = ps.map((p, idx) => ({ p, idx })).filter((x) => x.p.weekday === d);
      const alvo = doDiaIdx[i]?.idx;
      if (alvo === undefined) return ps;
      const novo = [...ps];
      novo[alvo] = { ...novo[alvo], [campo]: v };
      return novo;
    });
  const juntar = (d: number) =>
    setPeriodos((ps) => [...ps, { weekday: d, opens_at: "08:00", closes_at: "18:00" }]);
  const tirar = (d: number, i: number) =>
    setPeriodos((ps) => {
      const doDiaIdx = ps.map((p, idx) => ({ p, idx })).filter((x) => x.p.weekday === d);
      const alvo = doDiaIdx[i]?.idx;
      return alvo === undefined ? ps : ps.filter((_, idx) => idx !== alvo);
    });
  const copiarParaTodos = (d: number) => {
    const base = doDia(d);
    if (base.length === 0) return toast.error(t("businessHours.nothingToCopy"));
    setPeriodos(
      Array.from({ length: 7 }, (_, dia) =>
        base.map((p) => ({ ...p, weekday: dia })),
      ).flat(),
    );
    toast.success(t("businessHours.copiedToWeek"));
  };

  if (isLoading) {
    return <Card><CardContent className="p-4">
      <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
    </CardContent></Card>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4" /> {t("businessHours.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t("businessHours.acceptingOrders")}</p>
            <p className="text-xs text-muted-foreground">
              {t("businessHours.acceptingHint")}
            </p>
          </div>
          <Switch checked={aceita} onCheckedChange={(v) => alternarAceitar.mutate(v)} />
        </div>

        {data && (
          <p className="text-xs text-muted-foreground">
            {t("businessHours.now")}{" "}
            <strong className={data.aberto_agora ? "text-primary" : "text-destructive"}>
              {t(data.aberto_agora ? "businessHours.open" : "businessHours.closed")}
            </strong>
            {periodos.length === 0 && t("businessHours.alwaysOpenHint")}
          </p>
        )}

        <div className="space-y-3">
          {DIAS.map((nome, d) => {
            const ps = doDia(d);
            return (
              <div key={d} className="space-y-2 border-b pb-3 last:border-b-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{nome}</span>
                  <div className="flex gap-1">
                    {ps.length > 0 && (
                      <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs"
                        onClick={() => copiarParaTodos(d)}>
                        <Copy className="h-3 w-3 mr-1" />{t("businessHours.copy")}
                      </Button>
                    )}
                    <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs"
                      onClick={() => juntar(d)}>
                      <Plus className="h-3 w-3 mr-1" />{t("businessHours.period")}
                    </Button>
                  </div>
                </div>
                {ps.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("businessHours.closed")}</p>
                ) : (
                  ps.map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input type="time" className="h-10 flex-1" value={p.opens_at}
                        onChange={(e) => mudar(d, i, "opens_at", e.target.value)} />
                      <span className="text-muted-foreground text-sm">→</span>
                      <Input type="time" className="h-10 flex-1" value={p.closes_at}
                        onChange={(e) => mudar(d, i, "closes_at", e.target.value)} />
                      <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0"
                        onClick={() => tirar(d, i)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground">
          {t("businessHours.overnightHint")}
        </p>

        <Button className="w-full h-12" onClick={() => gravar.mutate()} disabled={gravar.isPending}>
          {gravar.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {t("businessHours.save")}
        </Button>
      </CardContent>
    </Card>
  );
};
