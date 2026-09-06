import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Search, MapPin, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import restaurantesBg from "@/assets/cat-restaurantes.jpg";

type SectionKey = "lojas";

const Index = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const cards: { tipo: SectionKey; title: string; tagline: string; bg: string }[] = [
    { tipo: "lojas", title: t("home.shopsShort"), tagline: t("home.restaurantesTagline"), bg: restaurantesBg },
  ];

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(search.trim() ? `/explorar?q=${encodeURIComponent(search.trim())}` : "/explorar");
  };

  return (
    <div className="mx-auto max-w-lg px-4 pb-6 pt-5 sm:px-6">
      <h1 className="sr-only">Bornaal</h1>

      {/* Search */}
      <form onSubmit={handleSearch}>
        <div className="relative">
          <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("common.searchPlaceholder")}
            aria-label={t("common.searchPlaceholder")}
            className="h-12 rounded-full bg-card pl-12 pr-4 text-body"
          />
        </div>
      </form>

      {/* Location */}
      <div className="mt-3 mb-5 flex items-center gap-1.5 text-caption text-muted-foreground">
        <MapPin className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <span>{t("home.locationLabel")}</span>
      </div>

      {/* Category entry cards */}
      <div className="flex flex-col gap-4">
        {cards.map((c) => (
          <Link
            key={c.tipo}
            to={`/explorar?tipo=${c.tipo}`}
            data-testid={`card-${c.tipo}`}
            className="group relative block h-44 overflow-hidden rounded-2xl shadow-soft transition-shadow hover:shadow-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                <h2 className="truncate text-title text-white drop-shadow-sm">{c.title}</h2>
                <p className="mt-0.5 truncate text-caption text-white/85">{c.tagline}</p>
              </div>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/90 shadow-lg backdrop-blur-sm transition-transform duration-300 group-hover:translate-x-0.5">
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
