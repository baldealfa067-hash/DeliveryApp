import { useEffect, useState } from "react";

/**
 * Segue uma media query em JS. Necessário quando a decisão não é só de estilo —
 * por exemplo, mostrar o detalhe do pedido num diálogo ou num painel lateral:
 * o diálogo é renderizado num portal e esconder por CSS não chega.
 */
export const useMediaQuery = (query: string): boolean => {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    onChange();
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
};

/** A partir daqui há espaço para lista e detalhe lado a lado (§5.7 do plano). */
export const useIsWideScreen = () => useMediaQuery("(min-width: 1024px)");
