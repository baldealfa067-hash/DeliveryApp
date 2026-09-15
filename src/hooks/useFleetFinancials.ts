import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Conta corrente da frota (§32, §53, §84).
 *
 * Vem de `get_fleet_financials`, uma RPC, e não de um `select()` em
 * `deliveries` — essa tabela está fechada à frota de propósito (decisão de
 * 2026-09-10) e uma leitura directa devolve **lista vazia, sem erro**. Código
 * novo que lesse a tabela parecia funcionar e não mostrava nada.
 *
 * Os movimentos saem do ledger, onde cada linha guarda a base e a taxa do
 * momento. Nada aqui é recalculado no browser — foi exactamente isso que o
 * painel do restaurante fazia e que a Fase 6 veio corrigir (§46).
 */
export interface MovimentoLedger {
  id: string;
  tipo:
    | "comissao_frota"
    | "divida_comida"
    | "credito_entrega"
    | "pagamento_comissao"
    | "reversao"
    | string;
  contraparte: "platform" | "business" | "fleet";
  valor: number;
  base: number | null;
  taxa: number | null;
  pedido: number | null;
  nota: string | null;
  quando: string;
  /** Anulada por uma entrada de correcção. A original nunca é apagada (§56). */
  revertida: boolean;
}

export interface FleetFinancials {
  fleet_id: string;
  taxa_actual: number;
  entregas_faturadas: number;
  valor_entregas: number;
  comissao_gerada: number;
  comissao_paga: number;
  /** Positivo = a frota deve à plataforma. */
  divida_plataforma: number;
  /** Positivo = a frota tem a entregar aos restaurantes (§28, dinheiro). */
  divida_restaurantes: number;
  /**
   * Positivo = a frota tem a RECEBER dos restaurantes. É o espelho do §28 nos
   * pedidos pagos online: o cliente pagou tudo ao restaurante, e a taxa de
   * entrega que ficou lá é da frota (decisão de 2026-09-15).
   */
  a_receber_restaurantes: number;
  movimentos: MovimentoLedger[];
}

export const useFleetFinancials = (activo = true) =>
  useQuery<FleetFinancials | null>({
    queryKey: ["fleet-financials"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_fleet_financials");
      if (error) throw error;
      const d = data as unknown as FleetFinancials | null;
      if (!d) return null;
      // numeric do Postgres chega como string no JSON: somar sem converter
      // dava concatenação em silêncio.
      return {
        ...d,
        taxa_actual: Number(d.taxa_actual ?? 0),
        entregas_faturadas: Number(d.entregas_faturadas ?? 0),
        valor_entregas: Number(d.valor_entregas ?? 0),
        comissao_gerada: Number(d.comissao_gerada ?? 0),
        comissao_paga: Number(d.comissao_paga ?? 0),
        divida_plataforma: Number(d.divida_plataforma ?? 0),
        divida_restaurantes: Number(d.divida_restaurantes ?? 0),
        movimentos: (d.movimentos ?? []).map((m) => ({
          ...m,
          valor: Number(m.valor ?? 0),
          base: m.base == null ? null : Number(m.base),
          taxa: m.taxa == null ? null : Number(m.taxa),
        })),
      };
    },
    enabled: activo,
    staleTime: 30_000,
  });
