import { Link } from "react-router-dom";
import { ArrowLeft, Mail, Phone, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { LanguageSelector } from "@/components/LanguageSelector";
import logo from "@/assets/logotipo.png";

const About = () => {
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

      <div className="flex justify-center mb-8">
        <img src={logo} alt="Bornaal" className="w-72 md:w-80 h-auto" />
      </div>

      <h1 className="text-2xl font-bold mb-6">{t("aboutPage.title")}</h1>

      <section className="space-y-4 mb-10">
        <h2 className="text-lg font-semibold">{t("aboutPage.missionTitle")}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t("aboutPage.missionDesc")}
        </p>
      </section>

      <section className="space-y-4 mb-10">
        <h2 className="text-lg font-semibold">{t("aboutPage.visionTitle")}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t("aboutPage.visionDesc")}
        </p>
      </section>

      <section className="space-y-4 mb-10">
        <h2 className="text-lg font-semibold">{t("aboutPage.howItWorksTitle")}</h2>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <span className="text-primary font-bold">1.</span>
            <span>{t("aboutPage.step1")}</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary font-bold">2.</span>
            <span>{t("aboutPage.step2")}</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary font-bold">3.</span>
            <span>{t("aboutPage.step3")}</span>
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">{t("aboutPage.contactTitle")}</h2>
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-3 text-muted-foreground">
            <Mail className="h-4 w-4 text-primary" />
            <span>bornaal.com@gmail.com</span>
          </div>
          <div className="flex items-center gap-3 text-muted-foreground">
            <Phone className="h-4 w-4 text-primary" />
            <span>+245 957107795</span>
          </div>
          <div className="flex items-center gap-3 text-muted-foreground">
            <MapPin className="h-4 w-4 text-primary" />
            <span>Bissau, Guiné-Bissau</span>
          </div>
        </div>
      </section>
    </div>
  </div>
  );
};

export default About;
