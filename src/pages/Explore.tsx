import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, MapPin, SearchX, WifiOff } from "lucide-react";
import { ProviderCard } from "@/components/ProviderCard";
import { ProviderCardSkeleton } from "@/components/ProviderCardSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { CategoryChips, type ChipCategory } from "@/components/CategoryChips";
import { Pagination } from "@/components/Pagination";
import { useProviders, useBusinessCategories } from "@/hooks/useProviders";
import { useBairros } from "@/hooks/useBairros";
import { BAIRROS_FILTER } from "@/lib/locations";
import { getPageCount, paginateArray } from "@/lib/pagination";
import { useTranslation } from "react-i18next";

const PAGE_SIZE = 10;

type SectionKey = "lojas";

const Explore = () => {
  const { t } = useTranslation();
  const SECTIONS = [
    { key: "lojas" as const, label: t("explore.shopsTitle"), short: t("explore.shopsShort") },
  ] as const;
  const [searchParams, setSearchParams] = useSearchParams();
  const tipoParam = searchParams.get("tipo");
  const section: SectionKey = SECTIONS.some((s) => s.key === tipoParam)
    ? (tipoParam as SectionKey)
    : "lojas";
  const activeCategory = searchParams.get("categoria") || "";
  const qParam = searchParams.get("q") || "";
  const [search, setSearch] = useState(qParam);
  const [location, setLocation] = useState(BAIRROS_FILTER[0]);
  const [page, setPage] = useState(1);

  const { data: providers = [], isLoading: loadingProviders, error: providersError, refetch } = useProviders("business");
  const { data: businessCategories = [] } = useBusinessCategories();
  const { data: bairros = [] } = useBairros();
  const bairroOptions = bairros.length ? [BAIRROS_FILTER[0], ...bairros] : BAIRROS_FILTER;
  const displayBairro = (loc: string) => (loc === BAIRROS_FILTER[0] ? t("common.allNeighborhoods") : loc);

  const categories = businessCategories as ChipCategory[];

  // Sync q param to search state on mount
  useEffect(() => {
    if (qParam) setSearch(qParam);
  }, [qParam]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [search, location, activeCategory, section]);

  const setCategory = (cat: string) => {
    const params: Record<string, string> = { tipo: section };
    if (cat) params.categoria = cat;
    if (search) params.q = search;
    setSearchParams(params);
  };

  const clearFilters = () => {
    setSearch("");
    setLocation(BAIRROS_FILTER[0]);
    setSearchParams({ tipo: section });
  };

  const hasFilters = Boolean(search || activeCategory) || location !== BAIRROS_FILTER[0];

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
    <div className="mx-auto max-w-lg px-4 pt-6 sm:px-6">
      <h1 className="mb-4 text-display">{current.label}</h1>

      <div className="relative mb-3">
        <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          placeholder={t("common.searchPlaceholder")}
          aria-label={t("common.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-12 rounded-full bg-card pl-12 text-body"
        />
      </div>

      {/* Filtro de bairro */}
      <div className="mb-4 flex items-center gap-2">
        <MapPin className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Select value={location} onValueChange={setLocation}>
          <SelectTrigger className="h-12 bg-card text-body" aria-label={t("common.location")}>
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
        <div className="mb-4">
          <CategoryChips categories={categories} active={activeCategory} onChange={setCategory} />
        </div>
      )}

      {loadingProviders ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <ProviderCardSkeleton key={i} />
          ))}
        </div>
      ) : providersError ? (
        <EmptyState
          icon={WifiOff}
          tone="problem"
          title={t("explore.errorTitle")}
          description={t("explore.errorHint")}
          action={{ label: t("common.tryAgain"), onClick: () => refetch() }}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title={t("explore.emptyTitle")}
          description={t("explore.emptyHint")}
          action={hasFilters ? { label: t("explore.clearFilters"), onClick: clearFilters } : undefined}
        />
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
