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
  const comida = orderTotal ?? 0;
  const taxa = deliveryFee ?? 0;
  const emDinheiro = (paymentMethod ?? "entrega") !== "online";
  const orangeMoneyPago = !emDinheiro && paymentStatus === "validado";

  return (
    <div className="mt-2 space-y-2 rounded-md border bg-muted/40 p-2">
      {items && items.length > 0 && (
        <div className="flex items-start gap-1.5">
          <Package className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <p className="text-[11px] leading-relaxed">
            {items.map((i, n) => (
              <span key={`${i.name}-${n}`}>
                {n > 0 && ", "}
                <span className="font-medium">{i.qty}×</span> {i.name}
              </span>
            ))}
          </p>
        </div>
      )}

      <div className="space-y-0.5 text-[11px]">
        {comida > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              Comida {emDinheiro && <span className="opacity-70">· do restaurante</span>}
            </span>
            <span className="tabular-nums">{formatCFA(comida)}</span>
          </div>
        )}
        {taxa > 0 && (
          <div className="flex justify-between font-medium text-primary">
            <span>A tua entrega</span>
            <span className="tabular-nums">{formatCFA(taxa)}</span>
          </div>
        )}
        {emDinheiro && comida > 0 && taxa > 0 && (
          <div className="flex justify-between border-t pt-0.5 font-semibold">
            <span>Recebes do cliente</span>
            <span className="tabular-nums">{formatCFA(comida + taxa)}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <Banknote className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[11px] font-medium">
          {orangeMoneyPago ? "Orange Money — pago" : emDinheiro ? "Dinheiro na entrega" : "Orange Money — por validar"}
        </span>
      </div>
    </div>
  );
};
