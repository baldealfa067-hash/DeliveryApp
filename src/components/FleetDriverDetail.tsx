import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatCFA } from "@/lib/format";
import { useDriverDetail } from "@/hooks/useFleet";

/**
 * Detalhe de um motorista, para o dono da frota (§12, §32).
 *
 * Painel lateral e não página nova: a frota está a olhar para a lista de
 * motoristas e quer espreitar um, não navegar para outro sítio e voltar.
 *
 * Tudo é contado na hora a partir de `deliveries` — §39, distinguir dado
 * registado de métrica calculada. Não há aqui nenhum número guardado.
 *
 * Quilometragem fica de fora de propósito (§40): `distance_km` existe, mas
 * enquanto o GPS não for fiável não se apresentam estimativas como se fossem
 * medições. Mesma decisão já tomada no painel da frota.
 */

const Metrica = ({ rotulo, valor }: { rotulo: string; valor: string | number }) => (
  <div className="rounded-md border p-2.5">
    <p className="text-[11px] text-muted-foreground">{rotulo}</p>
    <p className="mt-0.5 text-lg font-bold tabular-nums">{valor}</p>
  </div>
);

const hhmm = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-PT", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

export const FleetDriverDetail = ({
  driverId,
  onClose,
}: {
  driverId: string | null;
  onClose: () => void;
}) => {
  const { data, isLoading, error } = useDriverDetail(driverId);

  return (
    <Sheet open={!!driverId} onOpenChange={(aberto) => !aberto && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{data?.nome ?? "Motorista"}</SheetTitle>
        </SheetHeader>

        {isLoading && <p className="mt-4 text-sm text-muted-foreground">A carregar…</p>}

        {error && (
          <p className="mt-4 text-sm text-destructive">
            {error instanceof Error ? error.message : "Não foi possível carregar"}
          </p>
        )}

        {data && (
          <div className="mt-4 space-y-5 pb-8">
            <div className="grid grid-cols-2 gap-2">
              <Metrica rotulo="Entregas" valor={data.resumo.entregas} />
              <Metrica rotulo="Concluídas" valor={data.resumo.concluidas} />
              <Metrica rotulo="Ganhos" valor={formatCFA(data.resumo.ganhos)} />
              <Metrica
                rotulo="Tempo médio"
                /* null enquanto não houver entrega concluída: mostra-se um traço,
                   não "0 min", que seria afirmar rapidez que não se mediu (§84). */
                valor={data.resumo.minutos_medios != null ? `${data.resumo.minutos_medios} min` : "—"}
              />
            </div>

            {(data.resumo.canceladas > 0 || data.resumo.em_curso > 0) && (
              <p className="text-xs text-muted-foreground">
                {data.resumo.em_curso > 0 && `${data.resumo.em_curso} em curso`}
                {data.resumo.em_curso > 0 && data.resumo.canceladas > 0 && " · "}
                {data.resumo.canceladas > 0 && `${data.resumo.canceladas} canceladas`}
              </p>
            )}

            {/* ── Bairros ─────────────────────────────────────────────── */}
            <section>
              <h3 className="mb-2 text-sm font-semibold">Onde entregou</h3>
              {data.bairros.length === 0 ? (
                <p className="text-xs text-muted-foreground">Ainda sem entregas.</p>
              ) : (
                <div className="space-y-1.5">
                  {data.bairros.map((b) => (
                    <div key={b.bairro} className="flex items-center gap-2 text-sm">
                      <span className="flex-1 truncate">{b.bairro}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {b.entregas}×
                      </span>
                      <span className="w-24 text-right tabular-nums">{formatCFA(b.ganhos)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── Horas ───────────────────────────────────────────────── */}
            <section>
              <h3 className="mb-2 text-sm font-semibold">A que horas entrega</h3>
              {data.horas.length === 0 ? (
                <p className="text-xs text-muted-foreground">Ainda sem entregas concluídas.</p>
              ) : (
                <div className="space-y-1">
                  {data.horas.map((h) => {
                    const maximo = Math.max(...data.horas.map((x) => x.entregas));
                    return (
                      <div key={h.hora} className="flex items-center gap-2">
                        <span className="w-12 shrink-0 text-xs tabular-nums text-muted-foreground">
                          {String(h.hora).padStart(2, "0")}h
                        </span>
                        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${(h.entregas / maximo) * 100}%` }}
                          />
                        </div>
                        <span className="w-6 shrink-0 text-right text-xs tabular-nums">
                          {h.entregas}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* ── Últimas entregas ────────────────────────────────────── */}
            <section>
              <h3 className="mb-2 text-sm font-semibold">Últimas entregas</h3>
              {data.ultimas.length === 0 ? (
                <p className="text-xs text-muted-foreground">Ainda sem entregas.</p>
              ) : (
                <div className="space-y-2">
                  {data.ultimas.map((u) => (
                    <div key={u.order_number} className="rounded-md border p-2.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">#{u.order_number}</span>
                        <span className="tabular-nums">{u.taxa ? formatCFA(u.taxa) : "—"}</span>
                      </div>
                      <p className="mt-0.5 text-muted-foreground">
                        {u.bairro ?? "sem bairro"} · {u.estado}
                      </p>
                      <p className="mt-0.5 text-muted-foreground">
                        aceite {hhmm(u.aceite_em)} · entregue {hhmm(u.entregue_em)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};
