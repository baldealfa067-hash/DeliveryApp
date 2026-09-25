import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { LanguageSelector } from "@/components/LanguageSelector";
import logo from "@/assets/itudoo-logo-preto.png";

/**
 * Ecrã de entrada simples: logótipo, Entrar, Criar conta. É o que vê quem abre a
 * app INSTALADA (modo standalone) — já sabe o que o iTudoo é, e não tem de
 * atravessar a landing de marketing de cada vez que toca no ícone.
 *
 * O selector de idioma fica, e é o único extra: é o primeiro ecrã, e quem não
 * lê português tem de conseguir mudar antes de carregar num botão.
 */
const EntryScreen = () => {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen flex-col bg-background px-4">
      <header className="flex h-14 items-center justify-end">
        <LanguageSelector />
      </header>

      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center pb-10">
        <div className="text-center">
          {/* Fundo claro: logótipo PRETO. O nome continua no h1 para leitores de ecrã. */}
          <h1>
            <img src={logo} alt="iTudoo" className="mx-auto h-24 w-auto" />
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">{t("landing.tagline")}</p>
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

export default EntryScreen;
