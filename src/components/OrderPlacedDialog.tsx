import { CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Estado de navegação com que o checkout e o Enviar chegam a `/pedido/:id`. */
export type AcabadoDeCriar = { criado?: boolean; repetido?: boolean };

/**
 * A confirmação de que o pedido foi mesmo criado (2026-09-26).
 *
 * Antes, um pedido de restaurante acabava num toast de 4 segundos em cima da
 * página da loja, com o carrinho vazio — o cliente ficava sem saber se tinha
 * resultado nem onde o seguir (§52). Abre-se AQUI, na página de acompanhamento,
 * para onde os dois fluxos (comida e envio) passam a levar o cliente: o ecrã
 * que ele vê por trás do diálogo é a resposta a "e agora, onde o sigo?".
 *
 * Diz também até quando pode cancelar — é a primeira vez que o cliente precisa
 * de o saber, e a regra é diferente nos dois tipos de pedido.
 */
export const OrderPlacedDialog = ({
  open,
  onClose,
  envio,
  repetido = false,
  orderNumber,
}: {
  open: boolean;
  onClose: () => void;
  envio: boolean;
  /** O envio já existia (duplo toque, §73): devolveu-se o mesmo. */
  repetido?: boolean;
  orderNumber?: number;
}) => {
  const { t } = useTranslation();
  const titulo = repetido
    ? t("orderPlaced.titleRepeated")
    : envio
      ? t("orderPlaced.titleSend")
      : t("orderPlaced.title");

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader className="items-center text-center sm:text-center">
          <CheckCircle2 className="h-14 w-14 text-success" aria-hidden="true" />
          <DialogTitle className="text-xl">{titulo}</DialogTitle>
          {orderNumber != null && (
            <p className="text-sm font-semibold text-muted-foreground">
              {t("orderPlaced.number", { number: orderNumber })}
            </p>
          )}
          <DialogDescription className="space-y-2 text-center text-sm">
            <span className="block">{envio ? t("orderPlaced.bodySend") : t("orderPlaced.body")}</span>
            <span className="block">{t("orderPlaced.later")}</span>
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-lg bg-muted px-3 py-2 text-center text-sm">
          {envio ? t("orderTracking.cancelUntilDriver") : t("orderTracking.cancelUntilRestaurant")}
        </p>
        <DialogFooter>
          <Button size="lg" className="w-full" onClick={onClose}>
            {t("orderPlaced.ok")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
