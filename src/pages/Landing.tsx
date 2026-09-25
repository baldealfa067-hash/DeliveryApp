import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { LanguageSelector } from "@/components/LanguageSelector";

/**
 * Ecrã de entrada de quem chega SEM sessão. Substitui a página de marketing
 * herdada do Bornaal (prestadores de serviços, pesquisa de electricistas), que
 * anunciava um produto que já não existe.
 *
 * Quem tem sessão nunca chega aqui: o HomeRoute (App.tsx) manda-o para /inicio,
 * e o RequireClientArea manda as contas de trabalho para o seu painel.
 *
 * O selector de idioma fica, e é o único extra: é o primeiro ecrã, e quem não
 * lê português tem de conseguir mudar antes de carregar num botão.
 */
const Landing = () => {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen flex-col bg-background px-4">
      <header className="flex h-14 items-center justify-end">
        <LanguageSelector />
      </header>

      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center pb-10">
        <div className="text-center">
          {/* Logótipo: quando existir o ficheiro limpo do iTudoo, entra aqui no
              lugar (ou por cima) do nome. O `logo.png` actual ainda é o "B" do
              Bornaal, por isso não é usado neste ecrã. */}
          <h1 className="text-5xl font-extrabold tracking-tight text-primary">iTudoo</h1>
          <p className="mt-3 text-lg text-muted-foreground">{t("landing.tagline")}</p>
        </div>

        <div className="mt-16 space-y-3">
          <Button asChild size="lg" className="h-14 w-full text-base font-semibold">
            <Link to="/login?mode=cliente">{t("landing.signIn")}</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="h-14 w-full text-base font-semibold">
            <Link to="/login?tab=registar">{t("landing.createAccount")}</Link>
          </Button>
        </div>

        {/* Navegar sem conta é permitido (§9) e tem de ser uma porta à vista.
            Antes só se chegava a /inicio pelo "Voltar" do ecrã de escolha de
            conta, e quem o encontrava achava que tinha entrado sem autenticação. */}
        <Link
          to="/inicio"
          className="mt-6 block py-2 text-center text-sm font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          {t("landing.browse")}
        </Link>
      </main>
    </div>
  );
};

export default Landing;
