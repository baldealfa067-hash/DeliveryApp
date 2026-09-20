import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StarRating } from "@/components/StarRating";
import { useRateableOrders, useRateOrder, type AlvoAvaliacao } from "@/hooks/useOrderRatings";

/**
 * Avaliar um pedido concluído (Fase 9.4, §38).
 *
 * Só aparece num pedido concluído do próprio cliente, e só para os alvos que
 * existem: um envio não tem restaurante, um pedido levantado ao balcão não teve
 * motorista. Quem decide isso é o servidor (`get_my_rateable_orders`) — o ecrã
 * limita-se a mostrar o que ele autoriza, e a RPC recusa na mesma se for forçada.
 *
 * Sem penalização e sem editar depois: §38 manda esperar por dados antes de
 * construir consequências, e uma avaliação enviada não se reescreve.
 */
const UmAlvo = ({
  orderId,
  alvo,
  titulo,
  jaAvaliou,
}: {
  orderId: string;
  alvo: AlvoAvaliacao;
  titulo: string;
  jaAvaliou: boolean;
}) => {
  const { t } = useTranslation();
  const [estrelas, setEstrelas] = useState(0);
  const [comentario, setComentario] = useState("");
  const [aberto, setAberto] = useState(false);
  const avaliar = useRateOrder();

  if (jaAvaliou) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
        <span>{t("rateOrder.alreadyRated", { target: titulo })}</span>
      </div>
    );
  }

  const enviar = () => {
    if (estrelas < 1) {
      toast.error(t("rateOrder.pickStars"));
      return;
    }
    avaliar.mutate(
      { orderId, alvo, estrelas, comentario },
      {
        onSuccess: () => toast.success(t("rateOrder.thanks")),
        // A mensagem vem do servidor e é escrita para o cliente ("Este pedido ja
        // foi avaliado"), por isso mostra-se tal e qual em vez de um texto genérico.
        onError: (e: Error) => toast.error(e.message),
      },
    );
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{titulo}</p>
      <StarRating rating={estrelas} onChange={(n) => { setEstrelas(n); setAberto(true); }} size="md" />
      {aberto && (
        <>
          <Textarea
            placeholder={t("rateOrder.commentOptional")}
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
            rows={2}
          />
          <Button onClick={enviar} disabled={avaliar.isPending} size="sm" className="w-full">
            {avaliar.isPending ? t("rateOrder.sending") : t("rateOrder.submit")}
          </Button>
        </>
      )}
    </div>
  );
};

export const RateOrder = ({ orderId }: { orderId: string }) => {
  const { t } = useTranslation();
  const { data: estados = [] } = useRateableOrders();
  const estado = estados.find((e) => e.order_id === orderId);

  // Sem estado, o pedido não está concluído ou não é deste cliente: nada a mostrar.
  if (!estado) return null;
  const mostraRestaurante = estado.pode_avaliar_restaurante;
  const mostraMotorista = estado.pode_avaliar_motorista;
  if (!mostraRestaurante && !mostraMotorista) return null;
  if (estado.avaliou_restaurante && estado.avaliou_motorista) return null;
  if (mostraRestaurante && !mostraMotorista && estado.avaliou_restaurante) return null;
  if (mostraMotorista && !mostraRestaurante && estado.avaliou_motorista) return null;

  return (
    <Card className="mb-4">
      <CardContent className="p-4 space-y-4">
        <h2 className="text-sm font-semibold">{t("rateOrder.title")}</h2>
        {mostraRestaurante && (
          <UmAlvo orderId={orderId} alvo="restaurante" titulo={t("rateOrder.restaurant")} jaAvaliou={estado.avaliou_restaurante} />
        )}
        {mostraMotorista && (
          <UmAlvo orderId={orderId} alvo="motorista" titulo={t("rateOrder.driver")} jaAvaliou={estado.avaliou_motorista} />
        )}
      </CardContent>
    </Card>
  );
};
