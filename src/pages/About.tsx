import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LanguageSelector } from "@/components/LanguageSelector";
import { ComoFunciona } from "@/components/landing/ComoFunciona";
import { ContactosEquipa } from "@/components/ContactosEquipa";
import logo from "@/assets/itudoo-logo-preto.png";

/**
 * Sobre o iTudoo (2026-09-25). Substitui o texto herdado do Bornaal, que falava
 * de "prestadores de serviços" e dava um email do Bornaal como contacto.
 */
const About = () => {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-lg px-4 py-6">
        <div className="mb-6 flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> {t("common.back")}
          </Link>
          <LanguageSelector />
        </div>

        <div className="mb-8 flex justify-center">
          <img src={logo} alt="iTudoo" className="h-20 w-auto" />
        </div>

        <h1 className="mb-4 text-display">{t("aboutPage.title")}</h1>
        <div className="mb-10 space-y-4 text-body leading-relaxed text-muted-foreground">
          <p>{t("aboutPage.intro1")}</p>
          <p>{t("aboutPage.intro2")}</p>
        </div>

        <section className="mb-10" aria-labelledby="sobre-como-funciona">
          <h2 id="sobre-como-funciona" className="mb-5 text-title">{t("landing.howTitle")}</h2>
          <ComoFunciona className="space-y-6" />
        </section>

        <section aria-labelledby="sobre-contacto">
          <h2 id="sobre-contacto" className="mb-4 text-title">{t("teamContact.title")}</h2>
          <ContactosEquipa />
        </section>
      </div>
    </div>
  );
};

export default About;
