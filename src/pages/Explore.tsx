import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, MapPin, Loader2 } from "lucide-react";
import { ProviderCard } from "@/components/ProviderCard";
import { Pagination } from "@/components/Pagination";
import { useProviders, useCategories, useBusinessCategories, useBeautyCategories } from "@/hooks/useProviders";
import { useBairros } from "@/hooks/useBairros";
import { BAIRROS_FILTER } from "@/lib/locations";
import { getPageCount, paginateArray } from "@/lib/pagination";
import { useTranslation } from "react-i18next";
import { getCategoryName } from "@/lib/categoryI18n";

const PAGE_SIZE = 10;

type SectionKey = "servicos" | "lojas" | "beleza";

const Explore = () => {
  const { t, i18n } = useTranslation();
  const SECTIONS = [
    { key: "servicos" as const, label: t("explore.providersTitle"), short: t("explore.providersShort") },
    { key: "lojas" as const, label: t("explore.shopsTitle"), short: t("explore.shopsShort") },
    { key: "beleza" as const, label: t("explore.belezaTitle"), short: t("explore.belezaShort") },
  ] as const;
  const [searchParams, setSearchParams] = useSearchParams();
  const tipoParam = searchParams.get("tipo");
  const section: SectionKey = SECTIONS.some((s) => s.key === tipoParam)
    ? (tipoParam as SectionKey)
    : "servicos";
  const activeCategory = searchParams.get("categoria") || "";
  const qParam = searchParams.get("q") || "";
  const [search, setSearch] = useState(qParam);
  const [location, setLocation] = useState(BAIRROS_FILTER[0]);
  const [page, setPage] = useState(1);

  const { data: providers = [], isLoading: loadingProviders, error: providersError } = useProviders(
    section === "lojas" ? "business" : section === "beleza" ? "beleza" : "provider"
  );
  const { data: serviceCategories = [] } = useCategories();
  const { data: businessCategories = [] } = useBusinessCategories();
  const { data: beautyCategories = [] } = useBeautyCategories();
  const { data: bairros = [] } = useBairros();
  const bairroOptions = bairros.length ? [BAIRROS_FILTER[0], ...bairros] : BAIRROS_FILTER;
  const displayBairro = (loc: string) => (loc === BAIRROS_FILTER[0] ? t("common.allNeighborhoods") : loc);

  const categories = section === "lojas" ? businessCategories : section === "beleza" ? beautyCategories : serviceCategories;

  // Sync q param to search state on mount
  useEffect(() => {
    if (qParam) setSearch(qParam);
  }, [qParam]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [search, location, activeCategory, section]);

  const goSection = (key: SectionKey) => {
    const params: Record<string, string> = { tipo: key };
    if (search) params.q = search;
    setSearchParams(params);
  };

  const setCategory = (cat: string) => {
    const params: Record<string, string> = { tipo: section };
    if (cat) params.categoria = cat;
    if (search) params.q = search;
    setSearchParams(params);
  };

  const current = SECTIONS.find((s) => s.key === section)!;

  const filtered = providers.filter((p) => {
    const matchCat = !activeCategory || p.category === activeCategory;
    const matchSearch =
      !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.location.toLowerCase().includes(search.toLowerCase()) ||
      p.category.toLowerCase().includes(search.toLowerCase());
    const matchLocation =
      location === BAIRROS_FILTER[0] ||
      p.location.toLowerCase().includes(location.toLowerCase());
    return matchCat && matchSearch && matchLocation;
  });

  const pageCount = getPageCount(filtered.length, PAGE_SIZE);
  const paginated = paginateArray(filtered, page, PAGE_SIZE);

  return (
    <div className="max-w-lg mx-auto px-4 pt-6">
      <h1 className="text-xl font-bold mb-3">{current.label}</h1>

      {/* Section switcher */}
      <div className="flex gap-1.5 rounded-full bg-muted p-1 mb-3">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => goSection(s.key)}
            className={`flex-1 rounded-full px-3 py-2 text-sm font-medium transition-colors ${
              section === s.key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {s.short}
          </button>
        ))}
      </div>

      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t("common.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10 bg-card"
        />
      </div>

      {/* Location filter */}
      <div className="flex items-center gap-2 mb-4">
        <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
        <Select value={location} onValueChange={setLocation}>
          <SelectTrigger className="h-9 text-sm bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {bairroOptions.map((loc) => (
              <SelectItem key={loc} value={loc}>{displayBairro(loc)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {categories.length > 0 && (
        <div className="flex gap-2 flex-wrap mb-4">
          <Badge
            variant={!activeCategory ? "default" : "outline"}
            className="cursor-pointer px-3 py-1"
            onClick={() => setCategory("")}
          >
            {t("common.all")}
          </Badge>
          {categories.map((cat) => {
            const ptName = (cat as unknown as string) as string | null ?? (cat as { name: string }).name;
            // cat may be object {name, name_en, name_fr}
            const catObj = typeof cat === "string" ? { id: cat, name: cat, name_en: null, name_fr: null } : cat as { id: string; name: string; name_en: string | null; name_fr: string | null };
            const display = getCategoryName(catObj, i18n.language);
            const value = catObj.name;
            return (
              <Badge
                key={catObj.id ?? value}
                variant={activeCategory === value ? "default" : "outline"}
                className="cursor-pointer px-3 py-1"
                onClick={() => setCategory(value)}
              >
                {display}
              </Badge>
            );
          })}
        </div>
      )}

      {loadingProviders ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : providersError ? (
        <p className="text-center text-destructive py-12 text-sm">{t("common.errorLoading")}</p>
      ) : filtered.length === 0 ? (
        <p className="text-center text-muted-foreground py-12 text-sm">
          {t("common.noResults")}
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {paginated.map((p) => (
              <ProviderCard key={p.id} {...p} />
            ))}
          </div>
          <Pagination page={page} pageCount={pageCount} total={filtered.length} onPageChange={setPage} />
        </>
      )}
    </div>
  );
};

export default Explore;