import { useTranslation } from "react-i18next";
import { SUPPORTED, type Lang } from "@/i18n";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Globe } from "lucide-react";

const LABELS: Record<Lang, string> = { pt: "PT", fr: "FR", en: "EN", kri: "Kriol" };
const FLAGS: Record<Lang, string> = { pt: "🇵🇹", fr: "🇫🇷", en: "🇬🇧", kri: "🇬🇼" };

export function LanguageSelector() {
  const { i18n } = useTranslation();
  const current = (SUPPORTED as readonly string[]).includes(i18n.language)
    ? (i18n.language as Lang)
    : "pt";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2">
          <Globe className="h-4 w-4" />
          <span className="text-xs font-medium">{FLAGS[current]} {LABELS[current]}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[120px]">
        {(SUPPORTED as readonly Lang[]).map((lng) => (
          <DropdownMenuItem
            key={lng}
            onClick={() => i18n.changeLanguage(lng)}
            className={current === lng ? "bg-accent" : ""}
          >
            <span className="mr-2">{FLAGS[lng]}</span> {LABELS[lng]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
