/**
 * Contacto directo com a equipa do iTudoo: dois números reais (2026-09-25,
 * pedido do dono). Um só sítio para os números — se mudarem, mudam aqui.
 */
export const NUMEROS_EQUIPA = ["957107795", "966804992"] as const;

/** "957107795" -> "+245 957 107 795" */
export const formatarNumero = (n: string) => `+245 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
