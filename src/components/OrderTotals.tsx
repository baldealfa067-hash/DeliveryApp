import { formatCFA } from "@/lib/format";

/**
 * Decomposição do que o cliente paga: comida + taxa de entrega + total.
 *
 * `orders.total` guarda SÓ a comida — §27 separa as duas parcelas de propósito,
 * e a Fase 6 vai precisar delas separadas para o ledger. Quem soma é a
 * interface, aqui, num sítio só, para os três ecrãs (acompanhamento do cliente,
 * histórico do cliente, painel do restaurante) não divergirem.
 *
 * Só pedidos de ENTREGA têm taxa. Comer no local e levantar mostram uma linha
 * só, como sempre mostraram — uma linha "Taxa de entrega: 0" num pedido que se
 * come no local seria ruído, não informação.
 *
 * `delivery_fee` a null é diferente de zero: são os pedidos anteriores à Fase 3,
 * e os de bairros que nenhuma frota serve. Nesses não se inventa uma taxa nem
 * se mostra 0 — mostra-se só o valor da comida, que é o único número de que o
 * sistema tem a certeza (§84).
 */
export const OrderTotals = ({
  total,
  deliveryFee,
  consumptionOption,
  labelTotal,
  compact = false,
}: {
  total: number;
  deliveryFee?: number | null;
  consumptionOption: string;
  /** Rótulo do total, para reaproveitar as traduções já existentes. */
  labelTotal: string;
  /** Uma linha só, para listas. */
  compact?: boolean;
}) => {
  const temTaxa =
    consumptionOption === "entrega" && deliveryFee != null && deliveryFee > 0;
  const aPagar = total + (temTaxa ? deliveryFee : 0);

  if (compact) {
    return (
      <span>
        {formatCFA(aPagar)}
        {temTaxa && (
          <span className="text-muted-foreground">
            {" "}
            ({formatCFA(total)} + {formatCFA(deliveryFee)} entrega)
          </span>
        )}
      </span>
    );
  }

  if (!temTaxa) {
    return (
      <div className="flex justify-between">
        <span className="text-body font-semibold">{labelTotal}</span>
        <span className="text-price text-primary">{formatCFA(total)}</span>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">Comida</span>
        <span>{formatCFA(total)}</span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">Taxa de entrega</span>
        <span>{formatCFA(deliveryFee)}</span>
      </div>
      <div className="flex justify-between border-t pt-1">
        <span className="text-body font-semibold">{labelTotal}</span>
        <span className="text-price text-primary">{formatCFA(aPagar)}</span>
      </div>
    </div>
  );
};
