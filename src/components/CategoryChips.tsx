import { cn } from "@/lib/utils";
import { getCategoryName } from "@/lib/categoryI18n";
import { useTranslation } from "react-i18next";

export interface ChipCategory {
  id: string;
  name: string;
  name_en: string | null;
  name_fr: string | null;
}

interface CategoryChipsProps {
  categories: ChipCategory[];
  /** Nome da categoria ativa; string vazia = "Todas". */
  active: string;
  onChange: (category: string) => void;
}

/**
 * Chips de categoria em scroll horizontal (§5.3).
 * Texto, não círculos com foto: carregam de imediato e não custam dados.
 */
export const CategoryChips = ({ categories, active, onChange }: CategoryChipsProps) => {
  const { t, i18n } = useTranslation();

  const chip = (key: string, label: string, value: string) => {
    const isActive = active === value;
    return (
      <button
        key={key}
        type="button"
        onClick={() => onChange(value)}
        aria-pressed={isActive}
        className={cn(
          "shrink-0 whitespace-nowrap rounded-full px-4 py-2.5 text-caption transition-colors",
          isActive
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground hover:bg-primary-light"
        )}
      >
        {label}
      </button>
    );
  };

  return (
    // -mx-4/px-4 deixa os chips correrem até à margem do ecrã sem cortar o primeiro.
    <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {chip("__all", t("common.all"), "")}
      {categories.map((cat) => chip(cat.id ?? cat.name, getCategoryName(cat, i18n.language), cat.name))}
    </div>
  );
};
