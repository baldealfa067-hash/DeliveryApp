import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LanguageSelector } from "@/components/LanguageSelector";

const Privacy = () => {
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

      <h1 className="text-2xl font-bold mb-6">{t("privacyPage.title")}</h1>
      <p className="text-xs text-muted-foreground mb-6">{t("privacyPage.lastUpdate")}</p>

      <div className="space-y-6 text-sm text-muted-foreground leading-relaxed">
        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">{t("privacyPage.s1Title")}</h2>
          <p>{t("privacyPage.s1Desc")}</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">{t("privacyPage.s2Title")}</h2>
          <p>{t("privacyPage.s2Desc")}</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">{t("privacyPage.s3Title")}</h2>
          <p>{t("privacyPage.s3Desc")}</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">{t("privacyPage.s4Title")}</h2>
          <p>{t("privacyPage.s4Desc")}</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">{t("privacyPage.s5Title")}</h2>
          <p>{t("privacyPage.s5Desc")}</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">{t("privacyPage.s6Title")}</h2>
          <p>{t("privacyPage.s6Desc")}</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">{t("privacyPage.s7Title")}</h2>
          <p>{t("privacyPage.s7Desc")}</p>
        </section>
      </div>
    </div>
  </div>
  );
};

export default Privacy;
