import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Fase 2.3 — fecho de caixa (§28).
 *
 * O dinheiro da comida é cobrado pelo MOTORISTA e devido ao restaurante. Estas
 * chamadas são o caminho por onde essa dívida é finalmente saldada: a frota
 * declara o que entregou, o restaurante confirma, e só então o ledger liquida.
 *
 * Nada aqui calcula dívidas. Os valores vêm decididos do servidor (§71) — o
 * mesmo motivo por que a aritmética do ledger saiu do browser na Fase 6: se o
 * ecrã somasse por sua conta, mostrava um número e a confirmação recusava por
 * outro.
 */
const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

const unwrap = <T,>(data: unknown, error: { message: string } | null): T => {
  if (error) throw new Error(error.message);
  return data as T;
};

export type EstadoAcerto = "declarado" | "confirmado" | "contestado" | "cancelado";

export interface Acerto {
  id: string;
  dia: string;
  valor: number;
  estado: EstadoAcerto;
  nota?: string | null;
  motivo_contestacao?: string | null;
  declarado_em: string;
  resolvido_em?: string | null;
  business_id?: string;
  fleet_id?: string;
  nome?: string | null;
  frota?: string | null;
}

export interface RestauranteEmDivida {
  business_id: string;
  nome: string;
  divida_aberta: number;
  recolhido_no_dia: number;
  declarado_por_confirmar: number;
  confirmado_no_dia: number;
}

export interface MotoristaDoDia {
  driver_id: string;
  nome: string;
  entregas_no_dia: number;
  dinheiro_recolhido: number;
}

export interface FechoDaFrota {
  fleet_id: string;
  dia: string;
  restaurantes: RestauranteEmDivida[];
  motoristas: MotoristaDoDia[];
  acertos: Acerto[];
}

export interface AcertosDoRestaurante {
  business_id: string;
  a_receber_total: number;
  acertos: Acerto[];
}

/** Invalidar TUDO o que mostra dinheiro: um acerto mexe nas duas contas. */
const invalidarFinancas = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ["fecho-caixa"] });
  qc.invalidateQueries({ queryKey: ["fleet", "financials"] });
  qc.invalidateQueries({ queryKey: ["business", "commission"] });
  qc.invalidateQueries({ queryKey: ["commission"] });
};

export const useFleetCashClosing = (dia?: string) =>
  useQuery({
    queryKey: ["fecho-caixa", "frota", dia ?? "hoje"],
    queryFn: async () => {
      const { data, error } = await rpc("get_fleet_cash_closing", { p_dia: dia ?? null });
      return unwrap<FechoDaFrota>(data, error);
    },
  });

export const useBusinessCashSettlements = (businessId: string | null) =>
  useQuery({
    queryKey: ["fecho-caixa", "restaurante", businessId],
    enabled: !!businessId,
    queryFn: async () => {
      const { data, error } = await rpc("get_business_cash_settlements", {
        p_business_id: businessId,
      });
      return unwrap<AcertosDoRestaurante>(data, error);
    },
  });

export const useDeclareCashSettlement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { businessId: string; valor: number; nota?: string }) => {
      const { data, error } = await rpc("declare_cash_settlement", {
        p_business_id: p.businessId,
        p_amount: p.valor,
        p_note: p.nota ?? null,
      });
      return unwrap<string>(data, error);
    },
    onSuccess: () => invalidarFinancas(qc),
  });
};

export const useConfirmCashSettlement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await rpc("confirm_cash_settlement", { p_settlement_id: id });
      return unwrap<{ liquidado: number; divida_restante: number }>(data, error);
    },
    onSuccess: () => invalidarFinancas(qc),
  });
};

export const useContestCashSettlement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: string; motivo: string }) => {
      const { error } = await rpc("contest_cash_settlement", {
        p_settlement_id: p.id,
        p_reason: p.motivo,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidarFinancas(qc),
  });
};

export const useCancelCashSettlement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await rpc("cancel_cash_settlement", { p_settlement_id: id });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidarFinancas(qc),
  });
};
