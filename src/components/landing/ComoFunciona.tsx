import { useTranslation } from "react-i18next";
import { Mic, PackageCheck, Store, type LucideIcon } from "lucide-react";

/**
 * "Como funciona" em 3 passos. Um só componente para a landing e para /sobre:
 * duas cópias do mesmo texto acabavam por dizer coisas diferentes.
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

export const ComoFunciona = ({ className }: { className?: string }) => {
  const { t } = useTranslation();
  return (
    <ol className={className}>
      <Passo n={1} titulo={t("landing.step1Title")} texto={t("landing.step1Desc")} Icone={Store} />
      <Passo n={2} titulo={t("landing.step2Title")} texto={t("landing.step2Desc")} Icone={Mic} />
      <Passo n={3} titulo={t("landing.step3Title")} texto={t("landing.step3Desc")} Icone={PackageCheck} />
    </ol>
  );
};
