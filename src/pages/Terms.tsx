import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LanguageSelector } from "@/components/LanguageSelector";

const Terms = () => {
  const { t } = useTranslation();
  return (
  <div className="min-h-screen bg-background">
    <div className="absolute top-4 right-4">
      <LanguageSelector />
    </div>
    <div className="max-w-lg mx-auto px-4 py-8">
      <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground mb-6 hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> {t("common.back")}
      </Link>

      <h1 className="text-2xl font-bold mb-6">{t("termsPage.title")}</h1>
      <p className="text-xs text-muted-foreground mb-6">{t("termsPage.lastUpdate")}</p>

      <div className="space-y-6 text-sm text-muted-foreground leading-relaxed">
        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">{t("termsPage.s1Title")}</h2>
          <p>{t("termsPage.s1Desc")}</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">{t("termsPage.s2Title")}</h2>
          <p>{t("termsPage.s2Desc")}</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">{t("termsPage.s3Title")}</h2>
          <p>{t("termsPage.s3Desc")}</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">{t("termsPage.s4Title")}</h2>
          <p>{t("termsPage.s4Desc")}</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">{t("termsPage.s5Title")}</h2>
          <p>{t("termsPage.s5Desc")}</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">{t("termsPage.s6Title")}</h2>
          <p>{t("termsPage.s6Desc")}</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">{t("termsPage.s7Title")}</h2>
          <p>{t("termsPage.s7Desc")}</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">{t("termsPage.s8Title")}</h2>
          <p>{t("termsPage.s8Desc")}</p>
        </section>
      </div>
    </div>
  </div>
  );
};

export default Terms;
