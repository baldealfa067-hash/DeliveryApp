import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Banknote, Loader2, Undo2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { formatCFA } from "@/lib/format";
import {
  useFleetCashClosing, useDeclareCashSettlement, useCancelCashSettlement,
  type RestauranteEmDivida,
} from "@/hooks/useCashClosing";

/**
 * Fecho de caixa, lado da FROTA (§28, §83).
 *
 * O que a frota precisa de responder ao fim do dia é uma pergunta só: "de quem
 * é este dinheiro que os meus motoristas trouxeram, e quanto é que já entreguei
 * a cada um?". Por isso o ecrã é uma lista por restaurante, com a dívida em
 * primeiro — não um extracto de movimentos, que obrigava a somar de cabeça.
 *
 * O valor NÃO é validado aqui contra a dívida. Parece uma falha e é deliberado:
 * quem decide é `declare_cash_settlement`, no servidor, e duplicar a regra no
 * browser só criava duas verdades que podem divergir (§46, §71). O ecrã sugere
 * o valor em dívida e deixa o servidor recusar o que não puder aceitar.
 */
const ESTADOS: Record<string, { chave: string; classe: string }> = {
  declarado: { chave: "fleetCash.statePending", classe: "text-amber-600" },
  confirmado: { chave: "fleetCash.stateConfirmed", classe: "text-primary" },
  contestado: { chave: "fleetCash.stateContested", classe: "text-destructive" },
  cancelado: { chave: "fleetCash.stateWithdrawn", classe: "text-muted-foreground" },
};

export const FleetCashClosing = () => {
  const { t } = useTranslation();
  const { data: fecho, isLoading } = useFleetCashClosing();
  const declarar = useDeclareCashSettlement();
  const cancelar = useCancelCashSettlement();
  const [alvo, setAlvo] = useState<RestauranteEmDivida | null>(null);
  const [valor, setValor] = useState("");

  const abrir = (r: RestauranteEmDivida) => {
    setAlvo(r);
    // Sugere-se o que falta entregar — o caso normal é entregar tudo.
    const porEntregar = r.divida_aberta - r.declarado_por_confirmar;
    setValor(porEntregar > 0 ? String(Math.round(porEntregar)) : "");
  };

  const submeter = () => {
    if (!alvo) return;
    const n = Number(valor);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error(t("fleetCash.amountRequired"));
      return;
    }
    declarar.mutate(
      { businessId: alvo.business_id, valor: n },
      {
        onSuccess: () => {
          toast.success(t("fleetCash.declared"));
          setAlvo(null);
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  if (isLoading) {
    return (
      <Card><CardContent className="p-4">
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      </CardContent></Card>
    );
  }

  const restaurantes = fecho?.restaurantes ?? [];
  const motoristas = fecho?.motoristas ?? [];
  const acertos = fecho?.acertos ?? [];
  const totalEmDivida = restaurantes.reduce((s, r) => s + r.divida_aberta, 0);

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">{t("fleetCash.cashToHandOver")}</p>
          <p className="text-2xl font-bold">{formatCFA(totalEmDivida)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {t("fleetCash.cashHint")}
          </p>
        </CardContent>
      </Card>

      {restaurantes.length === 0 ? (
        <Card><CardContent className="p-4">
          <p className="text-sm text-muted-foreground">
            {t("fleetCash.nothingToSettle")}
          </p>
        </CardContent></Card>
      ) : (
        restaurantes.map((r) => {
          const porEntregar = r.divida_aberta - r.declarado_por_confirmar;
          return (
            <Card key={r.business_id}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-semibold min-w-0 truncate">{r.nome}</p>
                  <p className="text-lg font-bold whitespace-nowrap">{formatCFA(r.divida_aberta)}</p>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{t("fleetCash.collectedToday", { amount: formatCFA(r.recolhido_no_dia) })}</span>
                  {r.declarado_por_confirmar > 0 && (
                    <span className="text-amber-600">
                      {t("fleetCash.pendingConfirm", { amount: formatCFA(r.declarado_por_confirmar) })}
                    </span>
                  )}
                  {r.confirmado_no_dia > 0 && (
                    <span>{t("fleetCash.handedToday", { amount: formatCFA(r.confirmado_no_dia) })}</span>
                  )}
                </div>
                <Button
                  className="w-full h-12"
                  disabled={porEntregar <= 0}
                  onClick={() => abrir(r)}
                >
                  <Banknote className="h-4 w-4 mr-2" />
                  {porEntregar > 0 ? t("fleetCash.declareHandover") : t("fleetCash.allDeclared")}
                </Button>
              </CardContent>
            </Card>
          );
        })
      )}

      {motoristas.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-xs text-muted-foreground uppercase">{t("fleetCash.whoCollected")}</p>
            {motoristas.map((m) => (
              <div key={m.driver_id} className="flex justify-between text-sm">
                <span className="min-w-0 truncate">{m.nome}</span>
                <span className="whitespace-nowrap text-muted-foreground">
                  {m.entregas_no_dia} × · {formatCFA(m.dinheiro_recolhido)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {acertos.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-xs text-muted-foreground uppercase">{t("fleetCash.declarations")}</p>
            {acertos.map((a) => {
              const e = ESTADOS[a.estado] ?? ESTADOS.declarado;
              return (
                <div key={a.id} className="flex items-start justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate">{a.nome}</p>
                    <p className={`text-xs ${e.classe}`}>{t(e.chave)}</p>
                    {a.motivo_contestacao && (
                      <p className="text-xs text-destructive mt-0.5">{a.motivo_contestacao}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-semibold whitespace-nowrap">{formatCFA(a.valor)}</p>
                    {a.estado === "declarado" && (
                      <Button
                        variant="ghost" size="sm" className="h-7 px-2 text-xs"
                        onClick={() =>
                          cancelar.mutate(a.id, {
                            onSuccess: () => toast.success(t("fleetCash.withdrawn")),
                            onError: (err) => toast.error(err.message),
                          })
                        }
                      >
                        <Undo2 className="h-3 w-3 mr-1" />{t("fleetCash.withdraw")}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!alvo} onOpenChange={(o) => !o && setAlvo(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("fleetCash.handOverTo", { name: alvo?.nome })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("fleetCash.owed")} <strong>{formatCFA(alvo?.divida_aberta ?? 0)}</strong>
              {(alvo?.declarado_por_confirmar ?? 0) > 0 && (
                <> · {t("fleetCash.alreadyDeclared", { amount: formatCFA(alvo?.declarado_por_confirmar ?? 0) })}</>
              )}
            </p>
            <Input
              type="number" inputMode="numeric" min={1} className="h-12 text-lg"
              value={valor} onChange={(e) => setValor(e.target.value)}
              placeholder={t("fleetCash.amountPlaceholder")}
            />
            <p className="text-xs text-muted-foreground">
              {t("fleetCash.declareHint")}
            </p>
          </div>
          <DialogFooter>
            <Button className="w-full h-12" onClick={submeter} disabled={declarar.isPending}>
              {declarar.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("fleetCash.declare")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
