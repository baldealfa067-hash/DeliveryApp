/**
 * Mapeamento dos estados do pedido para as quatro cores de estado do sistema
 * (§3 do plano). Vive aqui e não dentro de um ecrã porque o mesmo estado tem de
 * ter a mesma cor no painel do restaurante, no do motorista e no acompanhamento
 * do cliente — três ecrãs que de outro modo divergiam.
 *
 * Regra do plano: a cor nunca é o único indicador. Quem usa estes tons mostra
 * sempre texto ou ícone ao lado, para daltónicos e para ecrãs maus ao sol.
 */
export type StateTone = "pending" | "progress" | "success" | "problem";

const ORDER_TONES: Record<string, StateTone> = {
  // À espera de alguém agir
  novo: "pending",
  aguardando_motorista: "pending",
  // A decorrer
  confirmado: "progress",
  em_preparacao: "progress",
  na_cozinha: "progress",
  pronto: "progress",
  em_entrega: "progress",
  saiu_para_entrega: "progress",
  motorista_encontrado: "progress",
  pedido_recolhido: "progress",
  a_caminho: "progress",
  // Fechado com sucesso
  entregue: "success",
  concluido: "success",
  // Problema
  cancelado: "problem",
};

export const orderStatusTone = (status: string): StateTone => ORDER_TONES[status] ?? "progress";

export const paymentStatusTone = (status: string | null | undefined): StateTone =>
  status === "validado" ? "success" : status === "rejeitado" ? "problem" : "pending";

/** Fundo suave + texto legível sobre ele, nos dois modos de cor. */
export const TONE_SOFT: Record<StateTone, string> = {
  pending: "bg-pending-soft text-pending-foreground",
  progress: "bg-progress-soft text-progress-foreground",
  success: "bg-success-soft text-success-foreground",
  problem: "bg-problem-soft text-problem-foreground",
};

/** Cor forte, para pontos, barras e anéis. */
export const TONE_STRONG: Record<StateTone, string> = {
  pending: "text-pending",
  progress: "text-progress",
  success: "text-success",
  problem: "text-problem",
};
