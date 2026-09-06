import { Link } from "react-router-dom";
import { MapPin, MessageCircle, Phone, BadgeCheck, Star } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCFA } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "react-i18next";
import { useBusinessCategories } from "@/hooks/useProviders";
import { translateCategoryName } from "@/lib/categoryI18n";

interface ProviderCardProps {
  id: string;
  name: string;
  category: string;
  location: string;
  phone: string;
  photo_url?: string | null;
  price_type?: string;
  starting_price?: number | null;
  services?: string[] | null;
  is_verified?: boolean | null;
  profile_type?: string | null;
  avgRating: number;
  reviewCount: number;
}

export const ProviderCard = ({
  id, name, category, location, phone, photo_url, price_type, starting_price, services, is_verified, avgRating, reviewCount
}: ProviderCardProps) => {
  const { t, i18n } = useTranslation();
  const { data: businessCats = [] } = useBusinessCategories();
  const catList = businessCats as { id: string; name: string; name_en: string | null; name_fr: string | null }[];
  const displayCategory = translateCategoryName(category, catList, i18n.language);
  const detailUrl = `/loja/${id}`;
  const cleanPhone = phone.replace(/\D/g, "");
  const whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(t("providerCardExtra.whatsappBusinessMsg", { name }))}`;
  const telUrl = `tel:${phone.replace(/\s/g, "")}`;

  const trackContact = (type: "whatsapp" | "call") => {
    supabase.rpc("record_provider_contact", { p_provider_id: id, contact_type: type }).then(({ error }) => {
      if (error) console.error(`[stats] record ${type} error:`, error.message);
    });
  };

  const priceLabel =
    price_type === "fixo" && starting_price != null ? formatCFA(starting_price)
    : price_type === "negociavel" ? t("common.negotiable")
    : price_type === "combinar" ? t("common.toCombine")
    : null;

  return (
    <Card className="relative overflow-hidden shadow-soft transition-all duration-200 hover:shadow-elevated active:scale-[0.99]">
      {/* Foto 16:9. O fundo sólido serve de placeholder enquanto carrega, para o
          cartão não saltar nem piscar em ligações lentas. */}
      <div className="aspect-video w-full bg-muted">
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
            <span className="text-4xl font-bold text-primary">{name.charAt(0)}</span>
          </div>
        )}
      </div>

      <div className="flex items-start gap-3 p-4">
        <div className="min-w-0 flex-1">
          <h3 className="flex min-w-0 items-center gap-1 text-title text-foreground">
            <span className="truncate">{name}</span>
            {is_verified && (
              <BadgeCheck
                className="h-5 w-5 shrink-0 text-primary"
                aria-label={t("providerCardExtra.verifiedLabel")}
              />
            )}
          </h3>

          <p className="mt-0.5 truncate text-caption text-muted-foreground">{displayCategory}</p>

          <div className="mt-1.5 flex items-center gap-1 text-caption text-muted-foreground">
            <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{location}</span>
          </div>

          {reviewCount > 0 && (
            <div className="mt-1.5 flex items-center gap-1 text-caption">
              <Star className="h-4 w-4 shrink-0 fill-secondary text-secondary" aria-hidden="true" />
              <span className="font-semibold text-foreground">{avgRating.toFixed(1)}</span>
              <span className="text-muted-foreground">({reviewCount})</span>
            </div>
          )}

          {services && services.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {services.slice(0, 2).map((s) => (
                <span key={s} className="rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground">
                  {s}
                </span>
              ))}
              {services.length > 2 && (
                <span className="px-1 py-0.5 text-caption text-muted-foreground">+{services.length - 2}</span>
              )}
            </div>
          )}

          {priceLabel && <p className="mt-2 text-price text-primary">{priceLabel}</p>}
        </div>

        {/* Contactos acima da camada clicável do cartão (z-20 > z-10). */}
        <div className="relative z-20 flex shrink-0 flex-col gap-2">
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("providerCard.contactWhatsapp", { name })}
            onClick={() => trackContact("whatsapp")}
          >
            <Button size="icon" className="h-12 w-12 bg-[#25D366] text-white hover:bg-[#1ebe57]">
              <MessageCircle className="h-5 w-5" />
            </Button>
          </a>
          <a href={telUrl} aria-label={t("providerCard.call", { name })} onClick={() => trackContact("call")}>
            <Button size="icon" variant="secondary" className="h-12 w-12">
              <Phone className="h-5 w-5" />
            </Button>
          </a>
        </div>
      </div>

      {/* Cartão inteiro clicável: um único link por cima de tudo, para o alvo de
          toque ser o cartão e não só o nome. */}
      <Link
        to={detailUrl}
        className="absolute inset-0 z-10 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <span className="sr-only">{name}</span>
      </Link>
    </Card>
  );
};
