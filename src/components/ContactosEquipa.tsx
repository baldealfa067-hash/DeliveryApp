import { useTranslation } from "react-i18next";
import { MessageCircle, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NUMEROS_EQUIPA, formatarNumero } from "@/lib/contactos";

/** Os dois números da equipa, cada um com "Ligar" e "WhatsApp". */
export const ContactosEquipa = () => {
  const { t } = useTranslation();
  return (
    <ul className="space-y-3">
      {NUMEROS_EQUIPA.map((n) => (
        <li key={n} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
          <span className="text-body font-semibold">{formatarNumero(n)}</span>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm" className="h-11 gap-1.5 px-4">
              <a href={`tel:+245${n}`} aria-label={`${t("teamContact.call")} ${formatarNumero(n)}`}>
                <Phone aria-hidden="true" /> {t("teamContact.call")}
              </a>
            </Button>
            <Button asChild size="sm" className="h-11 gap-1.5 px-4">
              <a
                href={`https://wa.me/245${n}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`WhatsApp ${formatarNumero(n)}`}
              >
                <MessageCircle aria-hidden="true" /> WhatsApp
              </a>
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
};
