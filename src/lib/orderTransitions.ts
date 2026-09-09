/**
 * Máquina de estados do pedido — §36 do documento mestre.
 *
 * A regra do §36 é que o frontend nunca pode provocar um salto arbitrário de
 * estado. Até à Fase 1 isso não estava garantido em lado nenhum: o servidor
 * validava que o valor do estado existia numa lista, mas nunca lia o estado
 * actual, e o frontend tinha a sua própria tabela em OrderManagement.tsx sem
 * relação nenhuma com o servidor.
 *
 * A autoridade é o servidor — `update_order_status`, migração
 * `fase1_authorize_and_validate_order_status`. Este ficheiro é o espelho dessa
 * tabela, para o ecrã só oferecer botões que o servidor vai aceitar. **Os dois
 * mudam sempre juntos**: se aqui abrir uma transição que o servidor recusa, o
 * utilizador leva um erro; se aqui fechar uma que o servidor aceita, a acção
 * desaparece do ecrã sem razão.
 *
 * Aditamento 2: os nomes dos estados não se renomeiam. `entregue` não aparece
 * aqui porque foi fundido em `concluido` na Fase 1 — era estado morto
 * duplicado, não nomenclatura viva.
 */

export type OrderStatus =
  | "novo"
  | "confirmado"
  | "em_preparacao"
  | "na_cozinha"
  | "pronto"
  | "saiu_para_entrega"
  | "aguardando_motorista"
  | "motorista_encontrado"
  | "pedido_recolhido"
  | "a_caminho"
  | "concluido"
  | "cancelado";

/** Quem está a pedir a mudança. O admin não passa por esta tabela. */
export type Actor = "owner" | "driver" | "customer" | "admin";

/**
 * Transições permitidas a partir de cada estado. Tem de ser idêntica ao bloco
 * `CASE v_current_status` da função `update_order_status`.
 */
export const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  novo: ["confirmado", "cancelado"],
  confirmado: ["em_preparacao", "cancelado"],
  em_preparacao: ["na_cozinha", "pronto", "cancelado"],
  na_cozinha: ["pronto", "cancelado"],
  pronto: ["aguardando_motorista", "concluido", "cancelado"],
  aguardando_motorista: ["motorista_encontrado", "cancelado"],
  motorista_encontrado: ["pedido_recolhido", "cancelado"],
  pedido_recolhido: ["a_caminho", "cancelado"],
  a_caminho: ["concluido"],
  saiu_para_entrega: ["a_caminho", "concluido"],
  // Terminais: não há saída. É o que impede reabrir um pedido já fechado.
  concluido: [],
  cancelado: [],
};

/** O motorista só toca na parte logística da entrega que lhe foi atribuída. */
const DRIVER_STATUSES: OrderStatus[] = ["pedido_recolhido", "a_caminho", "concluido"];

export const isTerminal = (status: OrderStatus): boolean =>
  ALLOWED_TRANSITIONS[status].length === 0;

/**
 * A mesma decisão que o servidor toma, para o ecrã não oferecer o que vai
 * levar erro. Nunca substitui a verificação do servidor — §46: a segurança
 * vive no backend, isto é só cortesia de interface.
 */
export const canTransition = (
  from: OrderStatus,
  to: OrderStatus,
  actor: Actor,
): boolean => {
  // O admin é a válvula de correcção operacional (fica registada no histórico).
  if (actor === "admin") return true;

  if (!ALLOWED_TRANSITIONS[from]?.includes(to)) return false;

  // O cliente só cancela, e só antes de o restaurante confirmar.
  if (actor === "customer") return to === "cancelado" && from === "novo";

  if (actor === "driver") return DRIVER_STATUSES.includes(to);

  return true; // owner
};

/** Próximos estados que este actor pode escolher a partir do estado actual. */
export const nextStatuses = (from: OrderStatus, actor: Actor): OrderStatus[] =>
  (actor === "admin"
    ? (Object.keys(ALLOWED_TRANSITIONS) as OrderStatus[])
    : ALLOWED_TRANSITIONS[from] ?? []
  ).filter((to) => canTransition(from, to, actor));

/**
 * O que o painel do restaurante oferece como botão, que é de propósito MAIS
 * ESTREITO do que o servidor permite ao dono.
 *
 * A diferença não é um esquecimento: em `aguardando_motorista` o servidor
 * aceita que o dono marque `motorista_encontrado` — existe como recurso para
 * quando um motorista aceita fora da aplicação — mas essa é a acção do
 * motorista, e pô-la no ecrã do restaurante convidava-o a mentir sobre um
 * passo que não é dele. Por isso o ecrã não a mostra.
 *
 * Esta tabela tem de ser sempre um subconjunto de ALLOWED_TRANSITIONS, e há um
 * teste que o verifica: oferecer um botão que o servidor recusa dá um erro ao
 * utilizador sem explicação nenhuma.
 */
export const RESTAURANT_PANEL_STEPS: Record<string, OrderStatus[]> = {
  novo: ["confirmado", "cancelado"],
  confirmado: ["em_preparacao", "cancelado"],
  em_preparacao: ["pronto"],
  // Pedido de balcão (comer no local / levantar): o restaurante fecha-o aqui.
  // Sendo entrega, `update_order_status` reencaminha sozinho para
  // `aguardando_motorista` e cria a entrega — o botão é o mesmo.
  pronto: ["concluido"],
  aguardando_motorista: [],
  motorista_encontrado: ["pedido_recolhido"],
  pedido_recolhido: ["a_caminho"],
  // Recurso para quando o motorista não confirma pela sua própria via.
  a_caminho: ["concluido"],
};
