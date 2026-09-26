/**
 * Até onde chegou um pedido cancelado (2026-09-26).
 *
 * A linha do tempo de um pedido cancelado mostrava o percurso inteiro a cinzento
 * (Em preparação, Pronto, A caminho…), como se ainda fosse passar por lá. Tem de
 * parar no ponto real onde parou — e esse ponto só o histórico sabe:
 * `orders.status` já diz `cancelado` e perdeu o estado anterior.
 *
 * Devolve o índice, em `fluxo`, do ÚLTIMO passo que o histórico registou. Conta
 * o mais avançado, não o mais recente: um pedido que passou por `pronto` e foi
 * reencaminhado para `aguardando_motorista` chegou a `aguardando_motorista`.
 *
 * Sem histórico (a leitura falhou ou ainda não chegou), fica no primeiro passo:
 * é o único que qualquer pedido do fluxo garantidamente teve, e é melhor mostrar
 * de menos do que inventar um percurso.
 */
export const ultimoPassoAntesDeCancelar = (
  fluxo: readonly string[],
  historico: ReadonlyArray<{ status: string }>,
): number => {
  let ultimo = 0;
  for (const h of historico) {
    const i = fluxo.indexOf(h.status);
    if (i > ultimo) ultimo = i;
  }
  return ultimo;
};
