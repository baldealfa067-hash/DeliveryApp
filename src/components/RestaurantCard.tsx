import { Link } from "react-router-dom";
import { MapPin, BadgeCheck, Star, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useBusinessCategories } from "@/hooks/useProviders";
import { translateCategoryName } from "@/lib/categoryI18n";
import { cn } from "@/lib/utils";

interface RestaurantCardProps {
  id: string;
  name: string;
  category: string;
  location: string;
  photo_url?: string | null;
  prep_time_minutes?: number | null;
  is_verified?: boolean | null;
  avgRating: number;
  reviewCount: number;
  /** Do servidor (`get_businesses_open`). `undefined` = não se sabe: sem selo. */
  abertoAgora?: boolean;
}

/**
 * Cartão da lista de restaurantes: a foto é o cartão, e o cartão inteiro leva
 * ao menu. Não tem botões de contacto — na lista o cliente quer ver o menu e
 * pedir, não negociar. Chat e telefone vivem na página do restaurante.
 */
export const RestaurantCard = ({
  id, name, category, location, photo_url, prep_time_minutes, is_verified, avgRating, reviewCount, abertoAgora,
}: RestaurantCardProps) => {
  const { t, i18n } = useTranslation();
  const { data: businessCats = [] } = useBusinessCategories();
  const catList = businessCats as { id: string; name: string; name_en: string | null; name_fr: string | null }[];
  const displayCategory = translateCategoryName(category, catList, i18n.language);

  return (
    <Link
      to={`/loja/${id}`}
      className="group block overflow-hidden rounded-lg border bg-card shadow-soft transition-all duration-200 hover:shadow-elevated active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <div className="relative aspect-video w-full bg-muted">
        {photo_url ? (
          <img
            src={photo_url}
            alt=""
            aria-hidden="true"
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-primary-light">
            <span className="text-5xl font-bold text-primary">{name.charAt(0).toUpperCase()}</span>
          </div>
        )}

        {/* Aberto / Fechado sem ter de entrar no restaurante (2026-09-26). Sobre
            a foto, por isso com fundo próprio — branco (aberto) ou preto
            (fechado) — e texto que não depende do que a foto tem por baixo. A
            cor nunca é o único sinal: vai sempre a palavra. */}
        {abertoAgora !== undefined && (
          <span
            className={cn(
              "absolute left-2 top-2 z-10 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-semibold shadow-card",
              abertoAgora ? "bg-card text-success-foreground" : "bg-ink/85 text-ink-foreground"
            )}
          >
            <span
              aria-hidden="true"
              className={cn("h-2 w-2 rounded-full", abertoAgora ? "bg-success" : "bg-muted-foreground")}
            />
            {abertoAgora ? t("businessHours.open") : t("businessHours.closed")}
          </span>
        )}

        {/* Máscara em gradiente: o nome tem de se ler sobre qualquer fotografia,
            clara ou escura. Só a metade de baixo escurece, para a foto respirar.
            Sem foto a máscara é da cor da marca e não preta — preto sobre o
            fundo claro do fallback fica turvo, parece um erro de renderização.
            E sobre o laranja o texto é PRETO: branco dava 2.61:1 (falha AA). */}
        <div
          className={cn(
            "absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t",
            photo_url
              ? "from-black/85 via-black/45 to-transparent"
              : "from-primary via-primary/60 to-transparent"
          )}
        />

        <div className="absolute inset-x-0 bottom-0 p-3">
          <h3 className={cn("flex min-w-0 items-center gap-1 text-title", photo_url ? "text-white drop-shadow-sm" : "text-primary-foreground")}>
            <span className="truncate">{name}</span>
            {is_verified && (
              <BadgeCheck
                className="h-5 w-5 shrink-0"
                aria-label={t("providerCardExtra.verifiedLabel")}
              />
            )}
          </h3>
          <p className={cn("truncate text-caption", photo_url ? "text-white/90 drop-shadow-sm" : "text-primary-foreground")}>{displayCategory}</p>
        </div>
      </div>

      <div className="flex items-center gap-3 px-4 py-3 text-caption text-muted-foreground">
        <span className="flex min-w-0 flex-1 items-center gap-1">
          <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{location}</span>
        </span>

        {/* Só aparece se o restaurante declarou o tempo. Sem valor por defeito. */}
        {prep_time_minutes != null && (
          <span className="flex shrink-0 items-center gap-1">
            <Clock className="h-4 w-4" aria-hidden="true" />
            {t("common.minutesShort", { minutes: prep_time_minutes })}
          </span>
        )}

        {reviewCount > 0 && (
          <span className="flex shrink-0 items-center gap-1">
            <Star className="h-4 w-4 fill-secondary text-secondary" aria-hidden="true" />
            <span className="font-semibold text-foreground">{avgRating.toFixed(1)}</span>
            <span>({reviewCount})</span>
          </span>
        )}
      </div>
    </Link>
  );
};
