import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Download,
  MapPin,
  Mic,
  PackageCheck,
  ShieldCheck,
  Star,
  Store,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useInstallApp } from "@/hooks/useInstallApp";
import logoBranco from "@/assets/itudoo-logo-branco.png";
import logoPreto from "@/assets/itudoo-logo-preto.png";

/**
 * Landing de marketing: o que vê quem chega pelo BROWSER (site, não app
 * instalada). Quem abre a app instalada vê o EntryScreen — ver Landing.tsx.
 *
 * Os textos não prometem o que a plataforma não faz: nenhum tempo de entrega,
 * nenhuma cidade além de Bissau (§2), nenhum "pagamento online" (§22).
 */
const Passo = ({ n, titulo, texto, Icone }: { n: number; titulo: string; texto: string; Icone: LucideIcon }) => (
  <li className="flex gap-4">
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
      <Icone className="h-6 w-6" aria-hidden="true" />
    </div>
    <div>
      <h3 className="text-title">
        <span className="text-primary">{n}.</span> {titulo}
      </h3>
      <p className="mt-1 text-body text-muted-foreground">{texto}</p>
    </div>
  </li>
);

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
      {/* Hero: fundo PRETO, por isso o logótipo BRANCO. */}
      <section className="bg-ink text-ink-foreground">
        <div className="mx-auto max-w-5xl px-4 pb-16 pt-4 md:pb-24">
          <header className="flex h-14 items-center justify-between">
            <img src={logoBranco} alt="iTudoo" className="h-10 w-auto" />
            <LanguageSelector />
          </header>

          <div className="mx-auto mt-12 max-w-2xl text-center md:mt-20">
            <h1 className="text-4xl font-bold leading-tight md:text-6xl">{t("landing.heroTitle")}</h1>
            <p className="mt-5 text-lg text-ink-foreground/80 md:text-xl">{t("landing.heroSubtitle")}</p>

            <div className="mx-auto mt-10 flex max-w-sm flex-col gap-3">
              <Button asChild size="lg" className="h-14 text-base">
                <Link to="/login?mode=cliente">{t("landing.signIn")}</Link>
              </Button>
              {/* Contorno claro: o `outline` normal tem borda cinzenta, que se
                  perde contra o preto. */}
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-14 border-ink-foreground/60 text-base text-ink-foreground hover:bg-ink-foreground/10 hover:text-ink-foreground"
              >
                <Link to="/login?tab=registar">{t("landing.createAccount")}</Link>
              </Button>
              <Link
                to="/inicio"
                className="mt-2 py-2 text-sm font-medium text-ink-foreground/80 underline underline-offset-4 hover:text-ink-foreground"
              >
                {t("landing.browse")}
              </Link>
            </div>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-5xl px-4">
        <section className="py-14 md:py-20" aria-labelledby="como-funciona">
          <h2 id="como-funciona" className="text-center text-display">{t("landing.howTitle")}</h2>
          <ol className="mx-auto mt-10 grid max-w-3xl gap-8 md:grid-cols-3">
            <Passo n={1} titulo={t("landing.step1Title")} texto={t("landing.step1Desc")} Icone={Store} />
            <Passo n={2} titulo={t("landing.step2Title")} texto={t("landing.step2Desc")} Icone={Mic} />
            <Passo n={3} titulo={t("landing.step3Title")} texto={t("landing.step3Desc")} Icone={PackageCheck} />
          </ol>
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
