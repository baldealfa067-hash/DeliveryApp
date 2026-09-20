import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Avaliações de um pedido concluído (Fase 9.4).
 *
 * Escreve-se SÓ pela RPC `rate_order`: `authenticated` não tem INSERT na tabela.
 * Não é detalhe de implementação — com INSERT directo o cliente escolhia a quem
 * dava a estrela, e um 5 no restaurante preferido não custava um pedido. O
 * servidor deriva o restaurante e o motorista do próprio pedido.
 */
export type AlvoAvaliacao = "restaurante" | "motorista";

export type EstadoAvaliacao = {
  order_id: string;
  pode_avaliar_restaurante: boolean;
  pode_avaliar_motorista: boolean;
  avaliou_restaurante: boolean;
  avaliou_motorista: boolean;
};

/** Uma chamada para a lista toda, não uma por pedido (N+1 no ecrã dos pedidos). */
export const useRateableOrders = (enabled = true) =>
  useQuery({
    queryKey: ["avaliacoes-possiveis"],
    enabled,
    queryFn: async (): Promise<EstadoAvaliacao[]> => {
      const { data, error } = await supabase.rpc("get_my_rateable_orders");
      if (error) throw error;
      return (data ?? []) as EstadoAvaliacao[];
    },
  });

export const useRateOrder = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { orderId: string; alvo: AlvoAvaliacao; estrelas: number; comentario?: string }) => {
      const { data, error } = await supabase.rpc("rate_order", {
        p_order_id: v.orderId,
        p_target: v.alvo,
        p_rating: v.estrelas,
        p_comment: v.comentario?.trim() || null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["avaliacoes-possiveis"] });
      // A página do restaurante mostra a média: sem isto ficava a antiga em cache.
      void qc.invalidateQueries({ queryKey: ["provider"] });
    },
  });
};
