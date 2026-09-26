import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Está aberto AGORA? Para os cartões da lista de restaurantes, numa chamada só
 * para a página inteira (`get_businesses_open`) — uma por cartão gastava dados
 * a quem os paga ao megabyte (§50).
 *
 * A regra é a do servidor (`is_business_open`): interruptor manual, horário,
 * períodos que passam a meia-noite, e "sem horário = sempre aberto". O ecrã
 * não a recalcula.
 *
 * Devolve um mapa id -> aberto. Um id que não está no mapa é "ainda não se
 * sabe" — o cartão não mostra selo, em vez de adivinhar.
 */
export const useBusinessesOpen = (ids: string[]) => {
  const chave = [...ids].sort();
  return useQuery({
    queryKey: ["restaurantes-abertos", chave],
    enabled: chave.length > 0,
    // Muda com o relógio: um restaurante abre às 12:00 com a página aberta.
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<Record<string, boolean>> => {
      const { data, error } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: { business_id: string; aberto_agora: boolean }[] | null; error: Error | null }>
      )("get_businesses_open", { p_ids: chave });
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((r) => [r.business_id, r.aberto_agora]));
    },
  });
};
