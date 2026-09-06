import { useEffect, useState } from "react";
import { LayoutGrid, MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getCategoryName } from "@/lib/categoryI18n";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { cn } from "@/lib/utils";

export interface GridCategory {
  id: string;
  name: string;
  name_en: string | null;
  name_fr: string | null;
}

interface CategoryGridProps {
  categories: GridCategory[];
  /** Nome da categoria ativa; string vazia = "Todas". */
  active: string;
  onChange: (category: string) => void;
  /** Nº de restaurantes por categoria, para ordenar as mais usadas à frente. */
  counts?: Record<string, number>;
}

/**
 * Colunas em função do que os nomes precisam, não de um número redondo: medido
 * a 360px, uma célula de 4 colunas dá 76px e "Supermercado" ocupa 93px a 13px —
 * e 13px é o mínimo da escala tipográfica, não se reduz. Fechar o espaçamento
 * não chegava, por isso a 4ª coluna só entra a partir dos 430px.
 */
const useColumnCount = () => {
  const [columns, setColumns] = useState(() =>
    typeof window === "undefined" ? 4 : window.innerWidth >= 640 ? 5 : window.innerWidth >= 430 ? 4 : 3
  );
  useEffect(() => {
    const read = () => setColumns(window.innerWidth >= 640 ? 5 : window.innerWidth >= 430 ? 4 : 3);
    const wide = window.matchMedia("(min-width: 640px)");
    const mid = window.matchMedia("(min-width: 430px)");
    wide.addEventListener("change", read);
    mid.addEventListener("change", read);
    read();
    return () => {
      wide.removeEventListener("change", read);
      mid.removeEventListener("change", read);
    };
  }, []);
  return columns;
};

export const CategoryGrid = ({ categories, active, onChange, counts = {} }: CategoryGridProps) => {
  const { t, i18n } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const columns = useColumnCount();

  // Duas linhas, seja qual for o número de colunas. O que não cabe vai para
  // "Ver todas" — nunca escondido atrás de um scroll que é preciso adivinhar.
  const slots = columns * 2;

  // Mais usadas primeiro, medido pelo nº real de restaurantes em cada categoria.
  // Empate resolvido por ordem alfabética para a grelha não dançar entre visitas.
  const ordered = [...categories].sort((a, b) => {
    const diff = (counts[b.name] ?? 0) - (counts[a.name] ?? 0);
    return diff !== 0 ? diff : a.name.localeCompare(b.name);
  });

  const overflows = ordered.length + 1 > slots;
  // "Todas" ocupa sempre o primeiro lugar; "Ver todas" o último, se houver excesso.
  const capacity = Math.max(slots - 1 - (overflows ? 1 : 0), 1);
  let visible = ordered.slice(0, capacity);

  // A categoria ativa tem de estar sempre à vista, mesmo que seja pouco usada:
  // caso contrário o filtro fica ligado sem nada no ecrã a dizê-lo.
  if (active && !visible.some((c) => c.name === active)) {
    const activeCat = ordered.find((c) => c.name === active);
    if (activeCat) visible = [...visible.slice(0, capacity - 1), activeCat];
  }

  const cell = (
    key: string,
    label: string,
    Icon: typeof LayoutGrid,
    isActive: boolean,
    onClick: () => void
  ) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      className="flex flex-col items-center gap-1.5 rounded-md py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        className={cn(
          "flex h-14 w-14 items-center justify-center rounded-full transition-colors",
          isActive ? "bg-primary text-primary-foreground" : "bg-primary-light text-primary"
        )}
      >
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      {/* Altura fixa de duas linhas para as filas ficarem alinhadas mesmo quando
          um nome ocupa duas ("Cabeleireiro e Salão"). */}
      <span
        className={cn(
          "line-clamp-2 h-[2.25rem] w-full text-center text-caption leading-tight",
          isActive ? "font-semibold text-primary" : "text-muted-foreground"
        )}
      >
        {label}
      </span>
    </button>
  );

  const allCell = (key: string, close: boolean) =>
    cell(key, t("common.all"), LayoutGrid, !active, () => {
      onChange("");
      if (close) setShowAll(false);
    });

  return (
    <>
      <div
        className={cn(
          "grid gap-x-2 gap-y-3",
          columns === 3 ? "grid-cols-3" : columns === 4 ? "grid-cols-4" : "grid-cols-5"
        )}
      >
        {allCell("__all", false)}

        {visible.map((cat) =>
          cell(
            cat.id ?? cat.name,
            getCategoryName(cat, i18n.language),
            getCategoryIcon(cat.name),
            active === cat.name,
            () => onChange(cat.name)
          )
        )}

        {overflows && cell("__more", t("common.seeAll"), MoreHorizontal, false, () => setShowAll(true))}
      </div>

      <Dialog open={showAll} onOpenChange={setShowAll}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("common.allCategories")}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-x-2 gap-y-4 pt-2 sm:grid-cols-4">
            {allCell("__all-dialog", true)}
            {ordered.map((cat) =>
              cell(
                `dialog-${cat.id ?? cat.name}`,
                getCategoryName(cat, i18n.language),
                getCategoryIcon(cat.name),
                active === cat.name,
                () => {
                  onChange(cat.name);
                  setShowAll(false);
                }
              )
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
