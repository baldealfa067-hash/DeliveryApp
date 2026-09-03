import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Search, MapPin, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import servicosBg from "@/assets/cat-servicos.jpg";
import restaurantesBg from "@/assets/cat-restaurantes.jpg";
import belezaBg from "@/assets/cat-beleza.jpg";

type SectionKey = "servicos" | "lojas" | "beleza";

const Index = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const cards: { tipo: SectionKey; title: string; tagline: string; bg: string }[] = [
    { tipo: "servicos", title: t("home.providersShort"), tagline: t("home.servicosTagline"), bg: servicosBg },
    { tipo: "lojas", title: t("home.shopsShort"), tagline: t("home.restaurantesTagline"), bg: restaurantesBg },
    { tipo: "beleza", title: t("home.belezaShort"), tagline: t("home.belezaTagline"), bg: belezaBg },
  ];

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(search.trim() ? `/explorar?q=${encodeURIComponent(search.trim())}` : "/explorar");
  };

  return (
    <div className="max-w-lg mx-auto px-4 pt-5 pb-6">
      <h1 className="sr-only">Bornaal</h1>

      {/* Search */}
      <form onSubmit={handleSearch}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("common.searchPlaceholder")}
            aria-label={t("common.searchPlaceholder")}
            className="pl-10 pr-4 h-11 rounded-full bg-card"
          />
        </div>
      </form>

      {/* Location */}
      <div className="flex items-center gap-1.5 mt-3 mb-5 text-sm text-muted-foreground">
        <MapPin className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
        <span>{t("home.locationLabel")}</span>
      </div>

      {/* Category entry cards */}
      <div className="flex flex-col gap-4">
        {cards.map((c) => (
          <Link
            key={c.tipo}
            to={`/explorar?tipo=${c.tipo}`}
            data-testid={`card-${c.tipo}`}
            className="group relative block h-44 rounded-2xl overflow-hidden shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <img
              src={c.bg}
              alt=""
              aria-hidden="true"
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04] group-active:scale-[1.02]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-black/10" />
            <div className="absolute inset-x-0 bottom-0 p-4 flex items-end justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-white text-lg font-bold leading-tight drop-shadow-sm truncate">{c.title}</h2>
                <p className="text-white/85 text-sm mt-0.5 truncate">{c.tagline}</p>
              </div>
              <span className="shrink-0 h-9 w-9 rounded-full bg-primary/90 backdrop-blur-sm flex items-center justify-center shadow-lg transition-transform duration-300 group-hover:translate-x-0.5">
                <ChevronRight className="h-5 w-5 text-primary-foreground" aria-hidden="true" />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
};

export default Index;
