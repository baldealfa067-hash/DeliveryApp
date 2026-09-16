import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Categoria "Enviar" (Fase 7, §19).
 *
 * O preço vem do servidor e é consultado ANTES de confirmar (§14): o cliente
 * tem de saber o que vai pagar antes de se comprometer. Não se calcula nada
 * aqui — `get_delivery_price` é a mesma função que a RPC usa para congelar o
 * preço no pedido, portanto o que o ecrã mostra e o que fica gravado não podem
 * divergir.
 */
const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string, args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export interface PrecoEntrega {
  fleet_id: string;
  fleet_name: string;
  preco: number;
}

export interface EnvioCriado {
  order_id: string;
  order_number: number;
  delivery_fee: number;
  fleet_name: string;
  motoristas_notificados?: number;
  repetido: boolean;
}

export type TipoEnvio = "documento" | "objeto" | "outro";

/** Preço para um bairro de destino. `null` = ninguém entrega lá. */
export const useDeliveryPrice = (bairro: string | null) =>
  useQuery({
    queryKey: ["preco-entrega", bairro],
    enabled: !!bairro && bairro.trim().length > 0,
    queryFn: async () => {
      const { data, error } = await rpc("get_delivery_price", { p_bairro: bairro });
      if (error) throw new Error(error.message);
      const linhas = (data ?? []) as PrecoEntrega[];
      return linhas.length > 0 ? linhas[0] : null;
    },
  });

export interface NovoEnvio {
  tipo: TipoEnvio;
  descricao: string;
  recolhaMorada: string;
  recolhaBairro: string | null;
  recolhaVoz: string | null;
  recolhaLat: number | null;
  recolhaLng: number | null;
  destinoMorada: string;
  destinoBairro: string;
  destinoVoz: string | null;
  destinoLat: number | null;
  destinoLng: number | null;
  nome: string;
  telefone: string;
}

export const useCreateSendOrder = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (e: NovoEnvio) => {
      const { data, error } = await rpc("create_send_order", {
        p_send_item_type: e.tipo,
        p_description: e.descricao || null,
        p_pickup_address: e.recolhaMorada,
        p_bairro: e.destinoBairro,
        p_address: e.destinoMorada,
        p_customer_name: e.nome,
        p_customer_phone: e.telefone,
        p_pickup_bairro: e.recolhaBairro,
        p_pickup_voice_note_url: e.recolhaVoz,
        p_voice_note_url: e.destinoVoz,
        p_pickup_lat: e.recolhaLat,
        p_pickup_lng: e.recolhaLng,
        p_customer_lat: e.destinoLat,
        p_customer_lng: e.destinoLng,
        p_payment_method: "entrega",
      });
      if (error) throw new Error(error.message);
      return data as EnvioCriado;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["customer-orders"] });
    },
  });
};
