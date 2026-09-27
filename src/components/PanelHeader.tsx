import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LanguageSelector } from "@/components/LanguageSelector";
import logo from "@/assets/itudoo-logo-preto.png";

/**
 * Cabeçalho dos painéis de trabalho (restaurante, motorista): logótipo, saída
 * para a app pública, idioma e sair.
 *
 * Tem de caber a 360px em qualquer dos 4 idiomas ("Voir le site" +
 * "Déconnexion" em francês). Por isso: logótipo mais baixo que não encolhe,
 * botões com menos margem, e "Sair" só com ícone abaixo de 640px — com
 * aria-label, para o leitor de ecrã continuar a dizê-lo. Antes a linha media
 * 366px num ecrã de 360 e a página inteira deslizava para o lado.
 *
 * "Ver site" vai a /inicio e não a "/": a raiz devolve contas de trabalho ao
 * seu painel, portanto usá-la aqui dava um botão que não saía do sítio.
 */
export const PanelHeader = ({ onLogout, extra }: { onLogout: () => void; extra?: ReactNode }) => {
  const { t } = useTranslation();
  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-4 py-3">
        <img src={logo} alt="iTudoo" className="h-7 w-auto shrink-0 sm:h-8" />
        <div className="flex min-w-0 items-center gap-1 sm:gap-2">
          <Link to="/inicio">
            <Button variant="outline" size="sm" className="min-h-11 gap-1 px-2 sm:px-3">
              <ArrowLeft className="h-4 w-4 shrink-0" /> {t("common.viewSite")}
            </Button>
          </Link>
          <LanguageSelector />
          {extra}
          <Button
            variant="ghost"
            size="sm"
            onClick={onLogout}
            className="min-h-11 min-w-11 gap-1 px-2 sm:px-3"
            aria-label={t("common.logout")}
            title={t("common.logout")}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">{t("common.logout")}</span>
          </Button>
        </div>
      </div>
    </header>
  );
};
