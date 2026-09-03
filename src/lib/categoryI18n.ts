export type TranslatedCategory = {
  id: string;
  name: string;
  name_en?: string | null;
  name_fr?: string | null;
};

/**
 * Retorna o nome da categoria na língua atual, com fallback para PT.
 * lang: 'pt' | 'en' | 'fr' (do i18n)
 */
export const getCategoryName = (
  cat: TranslatedCategory | null | undefined,
  lang: string
): string => {
  if (!cat) return "";
  if (lang?.startsWith("en") && cat.name_en?.trim()) return cat.name_en.trim();
  if (lang?.startsWith("fr") && cat.name_fr?.trim()) return cat.name_fr.trim();
  return cat.name;
};

/**
 * Dado o nome PT bruto (como guardado em profiles.category) e a lista de categorias,
 * retorna o nome traduzido. Se não encontrar, retorna o próprio nome PT.
 */
export const translateCategoryName = (
  rawName: string | null | undefined,
  categories: TranslatedCategory[],
  lang: string
): string => {
  if (!rawName) return "";
  const found = categories.find((c) => c.name === rawName);
  if (found) return getCategoryName(found, lang);
  // tenta também match por name_en/fr caso dado já venha traduzido
  const foundEn = categories.find((c) => c.name_en === rawName || c.name_fr === rawName);
  if (foundEn) return getCategoryName(foundEn, lang);
  return rawName;
};

/**
 * Ordena categorias pelo nome traduzido na língua atual
 */
export const sortCategoriesByLang = (
  cats: TranslatedCategory[],
  lang: string
): TranslatedCategory[] => {
  return [...cats].sort((a, b) =>
    getCategoryName(a, lang).localeCompare(getCategoryName(b, lang), lang)
  );
};
