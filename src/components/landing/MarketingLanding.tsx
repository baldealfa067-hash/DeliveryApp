import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Download, MapPin, ShieldCheck, Star, Timer, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useInstallApp } from "@/hooks/useInstallApp";
import { ComoFunciona } from "@/components/landing/ComoFunciona";
import heroArtwork from "@/assets/landing-delivery.webp";
import "./marketing-landing.css";
import logoPreto from "@/assets/itudoo-logo-preto.png";

/**
 * Landing de marketing: o que vê quem chega pelo BROWSER (site, não app
 * instalada). Quem abre a app instalada vê o EntryScreen — ver Landing.tsx.
 *
 * Os textos não prometem o que a plataforma não faz: nenhum tempo de entrega,
 * nenhuma cidade além de Bissau (§2), nenhum "pagamento online" (§22).
 */
const Vantagem = ({ titulo, texto, Icone }: { titulo: string; texto: string; Icone: LucideIcon }) => (
  <div className="rounded-xl border bg-card p-5 shadow-card">
    <Icone className="h-7 w-7 text-primary" aria-hidden="true" />
    <h3 className="mt-3 text-title">{titulo}</h3>
    <p className="mt-1 text-body text-muted-foreground">{texto}</p>
  </div>
);

const MarketingLanding = () => {
  const { t } = useTranslation();
  const { podeInstalar, instalar, ios } = useInstallApp();

  return (
    <div className="min-h-screen bg-background">
      <section className="overflow-hidden bg-[#fff7ee] text-[#171410]" aria-labelledby="landing-title">
        <div className="mx-auto max-w-[90rem] px-5 sm:px-8 lg:px-12">
          <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#e8d9ca] py-3.5 sm:flex-nowrap sm:gap-x-5">
            <img src={logoPreto} alt="iTudoo" className="mr-auto h-8 w-auto sm:h-10" />
            <LanguageSelector />
            <Link to="/login" className="rounded-md px-2 py-2 text-sm font-semibold hover:underline">
              {t("landing.signIn")}
            </Link>
            <Button asChild size="sm" className="bg-[#ff7900] text-[#171410] hover:bg-[#f16e00]">
              <Link to="/login?mode=cliente&tab=registar">{t("landing.createAccount")}</Link>
            </Button>
          </header>

          <div className="grid items-center gap-7 pt-10 sm:pt-14 lg:grid-cols-[5fr_7fr] lg:gap-5 lg:pt-5">
            <div className="landing-hero-copy relative z-10 pb-2 lg:py-14">
              <h1 id="landing-title" className="text-[clamp(2.4rem,4.1vw,4.25rem)] font-bold leading-[1.05] tracking-[-0.045em]">
                {t("landing.foodHeadline")}
                <br />
                {t("landing.sendHeadline")}
              </h1>
              <p className="mt-5 max-w-lg text-lg leading-relaxed text-[#514438] sm:text-xl">
                {t("landing.deliveryIntro")}
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Button asChild size="lg" className="h-12 bg-[#ff7900] text-[#171410] hover:bg-[#f16e00] motion-safe:transition-transform motion-safe:hover:-translate-y-0.5">
                  <Link to="/inicio">{t("landing.browse")}</Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="h-12 border-[#332a21] bg-transparent hover:bg-[#f7e8d9] motion-safe:transition-transform motion-safe:hover:-translate-y-0.5">
                  <Link to="/enviar">{t("landing.createShipment")}</Link>
                </Button>
              </div>
            </div>
            <div className="landing-hero-art relative mx-auto aspect-[4/3] w-full max-w-3xl" aria-hidden="true">
              <img src={heroArtwork} alt="" width={1200} height={900}
                className="landing-hero-phone absolute inset-0 size-full object-cover" />
              <img src={heroArtwork} alt="" width={1200} height={900}
                className="landing-hero-courier absolute inset-0 size-full object-cover" />
            </div>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-5xl px-4">
        <section className="py-14 md:py-20" aria-labelledby="como-funciona">
          <h2 id="como-funciona" className="text-center text-display">{t("landing.howTitle")}</h2>
          <ComoFunciona className="mx-auto mt-10 grid max-w-3xl gap-8 md:grid-cols-3" />
        </section>

        <section className="pb-14 md:pb-20" aria-labelledby="porque">
          <h2 id="porque" className="text-center text-display">{t("landing.whyTitle")}</h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Vantagem titulo={t("landing.fastTitle")} texto={t("landing.fastDesc")} Icone={Timer} />
            <Vantagem titulo={t("landing.safeTitle")} texto={t("landing.safeDesc")} Icone={ShieldCheck} />
            <Vantagem titulo={t("landing.everywhereTitle")} texto={t("landing.everywhereDesc")} Icone={MapPin} />
            <Vantagem titulo={t("landing.qualityTitle")} texto={t("landing.qualityDesc")} Icone={Star} />
          </div>
        </section>

        <section className="pb-16" aria-labelledby="app">
          <div className="rounded-2xl bg-primary-light px-6 py-10 text-center">
            <Download className="mx-auto h-8 w-8 text-primary" aria-hidden="true" />
            <h2 id="app" className="mt-3 text-display">{t("landing.appTitle")}</h2>
            <p className="mx-auto mt-2 max-w-md text-body text-muted-foreground">{t("landing.appDesc")}</p>
            {/* Botão só quando o browser deixa instalar; senão, instruções —
                um botão que não faz nada era pior do que nenhum. */}
            {podeInstalar ? (
              <Button size="lg" className="mt-6 h-14 px-8 text-base" onClick={() => void instalar()}>
                <Download aria-hidden="true" /> {t("landing.appInstall")}
              </Button>
            ) : (
              <p className="mx-auto mt-6 max-w-md text-body font-medium">
                {ios ? t("landing.appIosHint") : t("landing.appOtherHint")}
              </p>
            )}
          </div>
        </section>
      </main>

      <footer className="border-t bg-card">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 px-4 py-8 text-sm text-muted-foreground md:flex-row md:justify-between">
          <img src={logoPreto} alt="iTudoo" className="h-8 w-auto" />
          <nav className="flex gap-5">
            <Link to="/sobre" className="hover:text-foreground">{t("common.about")}</Link>
            <Link to="/termos" className="hover:text-foreground">{t("termsPage.title")}</Link>
            <Link to="/privacidade" className="hover:text-foreground">{t("privacyPage.title")}</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
};

export default MarketingLanding;
