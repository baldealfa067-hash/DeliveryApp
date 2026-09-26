import { useTranslation } from "react-i18next";
import { Package, Banknote } from "lucide-react";
import { formatCFA } from "@/lib/format";

/**
 * O que o motorista precisa de saber sobre uma entrega, além da morada.
 *
 * Faltavam três coisas no painel do motorista, e nenhuma era regressão — nunca
 * lá estiveram:
 *
 *  - **o que transporta.** §51: ele está na rua e precisa de conferir o pedido
 *    com o restaurante antes de sair.
 *  - **quanto ganha.** A taxa de entrega é a informação com que decide se vale
 *    a pena aceitar, e era a única que o servidor já mandava desde a Fase 3 —
 *    faltava só mostrá-la.
 *  - **quanto recebe e quanto deve.** §28: no pagamento em dinheiro é ele que
 *    recebe comida + entrega do cliente, e é o valor da comida que tem de
 *    voltar ao restaurante. Sem os dois números separados não sabe quanto pedir
 *    nem quanto entregar.
 *
 * Sobre o pagamento, mostra-se o MÉTODO, nunca um "Pago" automático (decisão do
 * dono do projecto, 2026-09-10). Em dinheiro, o sistema só sabe que a entrega
 * foi concluída — não sabe se o dinheiro mudou de mãos. Afirmá-lo seria dizer o
 * que não se sabe (§84). A reconciliação real é o ledger da Fase 6.
 */
export const DeliveryPayload = ({
  items,
  orderTotal,
  deliveryFee,
  paymentMethod,
  paymentStatus,
}: {
  items?: Array<{ name: string; price: number; qty: number }> | null;
  orderTotal?: number | null;
  deliveryFee?: number | null;
  paymentMethod?: string;
  paymentStatus?: string;
}) => {
  const { t } = useTranslation();
  const comida = orderTotal ?? 0;
  const taxa = deliveryFee ?? 0;
  const emDinheiro = (paymentMethod ?? "entrega") !== "online";
  const orangeMoneyPago = !emDinheiro && paymentStatus === "validado";

  // Texto a 13px no mínimo, e um item por linha: estava a 11px e com os itens
  // numa frase corrida, o que não se lê de pé na rua (§51).
  return (
    <div className="mt-3 w-full space-y-3 rounded-lg border bg-muted/40 p-3">
      {items && items.length > 0 && (
        <ul className="space-y-1">
          {items.map((i, n) => (
            <li key={`${i.name}-${n}`} className="flex items-start gap-2 text-sm">
              {n === 0 ? (
                <Package className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              ) : (
                <span className="w-4 shrink-0" aria-hidden="true" />
              )}
              <span className="min-w-0 break-words">
                <span className="font-semibold tabular-nums">{i.qty}×</span> {i.name}
              </span>
            </li>
          ))}
        </ul>
      )}

      <dl className="space-y-1 text-sm">
        {comida > 0 && (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="min-w-0 text-muted-foreground">
              {t("deliveryPayload.food")}
              {emDinheiro && <span className="block text-caption">{t("deliveryPayload.foodBelongsToRestaurant")}</span>}
            </dt>
            <dd className="shrink-0 tabular-nums">{formatCFA(comida)}</dd>
          </div>
        )}
        {taxa > 0 && (
          <div className="flex items-baseline justify-between gap-3 font-semibold text-primary">
            <dt>{t("deliveryPayload.yourFee")}</dt>
            <dd className="shrink-0 tabular-nums">{formatCFA(taxa)}</dd>
          </div>
        )}
        {emDinheiro && comida > 0 && taxa > 0 && (
          <div className="flex items-baseline justify-between gap-3 border-t pt-1.5 font-bold">
            <dt>{t("deliveryPayload.collectFromCustomer")}</dt>
            <dd className="shrink-0 tabular-nums">{formatCFA(comida + taxa)}</dd>
          </div>
        )}
      </dl>

      <p className="flex items-center gap-2 text-sm font-medium">
        <Banknote className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        {orangeMoneyPago
          ? t("deliveryPayload.orangeMoneyPaid")
          : emDinheiro
            ? t("deliveryPayload.cashOnDelivery")
            : t("deliveryPayload.orangeMoneyPending")}
      </p>
    </div>
  );
};
