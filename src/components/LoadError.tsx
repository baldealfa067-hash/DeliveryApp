import { AlertCircle, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

/**
 * Estado de falha de carregamento, com "tentar de novo" (Fase 9.2).
 *
 * Existe porque vários ecrãs tratavam só dois estados — "a carregar" e "com
 * dados" — e um erro de rede caía no primeiro para sempre: um spinner que nunca
 * pára. Em Bissau a rede falha com frequência; o erro tem de ser um estado
 * normal do ecrã, com uma saída, e não um beco sem aviso (§52).
 *
 * Usa chaves que já existiam nos 4 idiomas (`common.errorLoading`,
 * `common.tryAgain`), por isso não acrescenta texto por traduzir.
 */
export const LoadError = ({ onRetry, className = "" }: { onRetry: () => void; className?: string }) => {
  const { t } = useTranslation();
  return (
    <div className={`flex flex-col items-center justify-center text-center gap-3 py-10 ${className}`}>
      <AlertCircle className="h-10 w-10 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">{t("common.errorLoading")}</p>
      <Button variant="outline" className="h-11" onClick={onRetry}>
        <RefreshCw className="h-4 w-4 mr-2" />
        {t("common.tryAgain")}
      </Button>
    </div>
  );
};
