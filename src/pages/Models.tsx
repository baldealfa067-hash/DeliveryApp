import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import logo from "@/assets/logotipo.png";
import { useTranslation } from "react-i18next";

const Models = () => {
  const { t } = useTranslation();
  return (
  <div className="min-h-screen bg-background flex items-center justify-center px-4">
    <Link to="/" className="absolute top-6 left-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
      <ArrowLeft className="h-4 w-4" /> {t("modelsPage.home")}
    </Link>
    <div className="flex flex-col items-center gap-8">
      <img src={logo} alt="Bornaal" className="w-64 md:w-80 lg:w-96 h-auto drop-shadow-2xl" />
      <div className="text-center">
        <h1 className="text-3xl md:text-4xl font-bold text-foreground">Bornaal</h1>
        <p className="text-muted-foreground mt-2 max-w-sm mx-auto leading-relaxed">
          {t("modelsPage.tagline")}
        </p>
      </div>
    </div>
  </div>
  );
};

export default Models;
