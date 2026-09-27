/**
 * Espaços INSEPARÁVEIS (U+00A0) entre os milhares e antes de "CFA": um preço
 * nunca se parte em duas linhas. Com um espaço normal, "28 000 CFA" num cartão
 * estreito saía "28 000" numa linha e "CFA" na outra — na aba Vendas, no
 * checkout, nos detalhes do pedido e na lista de motoristas da frota
 * (auditoria de layout de 2026-09-27). Quem tiver de caber estreito que se
 * arrume em volta do preço, não o parta.
 */
export const formatCFA = (value?: number | null): string => {
  if (value == null) return "";
  return `${value.toLocaleString("pt-PT").replace(/[,\s]/g, "\u00a0")}\u00a0CFA`;
};
