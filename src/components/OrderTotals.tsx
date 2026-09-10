import { formatCFA } from "@/lib/format";

/**
 * Decomposição do que o cliente paga: comida + taxa de entrega + total.
 *
 * `orders.total` guarda SÓ a comida — §27 separa as duas parcelas de propósito,
 * e a Fase 6 vai precisar delas separadas para o ledger. Quem soma é a
 * interface, aqui, num sítio só, para os ecrãs não divergirem.
 *
 * `delivery_fee` a null é diferente de zero: são os pedidos anteriores à Fase 3,
 * e os de bairros que nenhuma frota serve. Nesses não se inventa uma taxa nem
 * se mostra 0 — mostra-se só o valor da comida, que é o único número de que o
 * sistema tem a certeza (§84).
 */

/** A regra de "este pedido tem taxa", num sítio só. */
export const temTaxaDeEntrega = (
  consumptionOption: string,
  deliveryFee?: number | null,
): deliveryFee is number =>
  consumptionOption === "entrega" && deliveryFee != null && deliveryFee > 0;

export const totalAPagar = (
  total: number,
  consumptionOption: string,
  deliveryFee?: number | null,
): number => total + (temTaxaDeEntrega(consumptionOption, deliveryFee) ? deliveryFee : 0);

type Variante =
  /** Decomposição completa em três linhas. Para o detalhe de um pedido. */
  | "full"
  /** Um número só, o que o cliente paga. Para listas em linha de texto. */
  | "inline"
  /**
   * Comida em destaque, taxa numa segunda linha por baixo. Para cartões
   * estreitos, onde a versão em linha colidia com o texto ao lado — foi
   * exactamente o que aconteceu no cartão do painel do restaurante, com o
   * número do pedido a sobrepor-se ao preço.
   */
  | "stacked";

export const OrderTotals = ({
  total,
  deliveryFee,
  consumptionOption,
  labelTotal,
  variant = "full",
}: {
  total: number;
  deliveryFee?: number | null;
  consumptionOption: string;
  /** Rótulo do total, para reaproveitar as traduções já existentes. */
  labelTotal?: string;
  variant?: Variante;
}) => {
  const temTaxa = temTaxaDeEntrega(consumptionOption, deliveryFee);
  const aPagar = totalAPagar(total, consumptionOption, deliveryFee);

  if (variant === "inline") {
    return <span>{formatCFA(aPagar)}</span>;
  }

  if (variant === "stacked") {
    return (
      <span className="block text-right">
        {/* A comida em destaque: é o valor que pertence ao restaurante (§28).
            A taxa vai por baixo, em linha própria — empilhadas não competem
            por largura, que era a causa da sobreposição. */}
        <span className="block text-price text-primary">{formatCFA(total)}</span>
        {temTaxa && (
          <span className="block whitespace-nowrap text-caption text-muted-foreground">
            + {formatCFA(deliveryFee)} entrega
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
