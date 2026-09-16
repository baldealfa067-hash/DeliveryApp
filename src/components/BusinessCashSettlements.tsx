import { useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { formatCFA } from "@/lib/format";
import {
  useBusinessCashSettlements, useConfirmCashSettlement, useContestCashSettlement,
  type Acerto,
} from "@/hooks/useCashClosing";

/**
 * Fecho de caixa, lado do RESTAURANTE (§28, §83).
 *
 * Aqui o dono responde a uma pergunta de cada vez: "a frota diz que me entregou
 * X — recebi?". Confirmar liquida a dívida; contestar deixa-a de pé com o
 * motivo registado, para o desacordo ficar escrito em vez de virar conversa.
 *
 * O botão de contestar EXIGE motivo — e não é burocracia. Sem ele a frota
 * recebe "não" sem saber o que corrigir, e o acerto fica preso entre os dois
 * (§84: o que se afirma tem de se poder explicar).
 */
export const BusinessCashSettlements = ({ businessId }: { businessId: string }) => {
  const { data, isLoading } = useBusinessCashSettlements(businessId);
  const confirmar = useConfirmCashSettlement();
  const contestar = useContestCashSettlement();
  const [aContestar, setAContestar] = useState<Acerto | null>(null);
  const [motivo, setMotivo] = useState("");

  if (isLoading) {
    return (
      <Card><CardContent className="p-4">
        <p className="text-sm text-muted-foreground">A carregar…</p>
      </CardContent></Card>
    );
  }

  const acertos = data?.acertos ?? [];
  const porConfirmar = acertos.filter((a) => a.estado === "declarado");
  const resolvidos = acertos.filter((a) => a.estado !== "declarado").slice(0, 8);

  const submeterContestacao = () => {
    if (!aContestar) return;
    if (motivo.trim().length === 0) {
      toast.error("Diga o que está errado — a frota precisa de saber o que corrigir.");
      return;
    }
    contestar.mutate(
      { id: aContestar.id, motivo: motivo.trim() },
      {
        onSuccess: () => {
          toast.success("Contestado. A dívida mantém-se.");
          setAContestar(null);
          setMotivo("");
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">A receber das frotas</p>
          <p className="text-2xl font-bold">{formatCFA(data?.a_receber_total ?? 0)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Dinheiro das suas vendas que os motoristas cobraram aos clientes (§28).
          </p>
        </CardContent>
      </Card>

      {porConfirmar.length === 0 ? (
        <Card><CardContent className="p-4">
          <p className="text-sm text-muted-foreground">Nada por confirmar.</p>
        </CardContent></Card>
      ) : (
        porConfirmar.map((a) => (
          <Card key={a.id} className="border-primary/30 bg-primary/5">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold truncate">{a.frota}</p>
                  <p className="text-xs text-muted-foreground">Caixa de {a.dia}</p>
                </div>
                <p className="text-xl font-bold whitespace-nowrap">{formatCFA(a.valor)}</p>
              </div>
              {a.nota && <p className="text-xs text-muted-foreground">{a.nota}</p>}
              <p className="text-sm">Recebeu este dinheiro?</p>
              <div className="flex gap-2">
                <Button
                  className="flex-1 h-12"
                  disabled={confirmar.isPending}
                  onClick={() =>
                    confirmar.mutate(a.id, {
                      onSuccess: (r) =>
                        toast.success(
                          `Confirmado. Ficam ${formatCFA(r.divida_restante)} por receber.`,
                        ),
                      onError: (e) => toast.error(e.message),
                    })
                  }
                >
                  {confirmar.isPending
                    ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    : <Check className="h-4 w-4 mr-2" />}
                  Recebi
                </Button>
                <Button
                  variant="outline" className="flex-1 h-12"
                  onClick={() => { setAContestar(a); setMotivo(""); }}
                >
                  <X className="h-4 w-4 mr-2" />
                  Não recebi
                </Button>
              </div>
            </CardContent>
          </Card>
        ))
      )}

      {resolvidos.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-xs text-muted-foreground uppercase">Histórico</p>
            {resolvidos.map((a) => (
              <div key={a.id} className="flex items-start justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate">{a.frota} · {a.dia}</p>
                  <p className={`text-xs ${
                    a.estado === "confirmado" ? "text-primary"
                    : a.estado === "contestado" ? "text-destructive"
                    : "text-muted-foreground"}`}>
                    {a.estado === "confirmado" ? "Confirmado"
                      : a.estado === "contestado" ? `Contestado — ${a.motivo_contestacao}`
                      : "Retirado pela frota"}
                  </p>
                </div>
                <p className="font-semibold whitespace-nowrap shrink-0">{formatCFA(a.valor)}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!aContestar} onOpenChange={(o) => !o && setAContestar(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Contestar {formatCFA(aContestar?.valor ?? 0)}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              A dívida mantém-se e a frota é avisada. Diga o que aconteceu.
            </p>
            <Textarea
              value={motivo} onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex: só recebi 3.000 FCFA"
              className="min-h-24"
            />
          </div>
          <DialogFooter>
            <Button
              variant="destructive" className="w-full h-12"
              onClick={submeterContestacao} disabled={contestar.isPending}
            >
              {contestar.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Contestar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
