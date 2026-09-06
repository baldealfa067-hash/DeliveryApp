import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * O tailwind-merge só conhece a escala default do Tailwind. Sem estas extensões
 * ele não reconhece os tokens do sistema de design e trata-os como classes de
 * outro grupo — `cn("text-title", "text-foreground")` devolvia só
 * `text-foreground`, deitando fora o tamanho, e `shadow-sm` do Card sobrevivia
 * por cima de `shadow-soft`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["display", "title", "body", "caption", "price"] }],
      shadow: [{ shadow: ["soft", "elevated"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
