import { useTranslation } from "react-i18next";

export interface PeriodoHorario {
  weekday: number;
  opens_at: string;
  closes_at: string;
}

/**
 * Aviso de loja fechada, no topo da página da loja, com o horário da semana.
 *
 * Aparece no topo, não junto ao botão: descobrir que está fechado depois de
 * encher o carrinho é a pior altura para o saber (§52).
 *
 * Os dias vêm do i18n (`businessHours.days`, indexado por `weekday`, 0 =
 * domingo — o que o backend guarda), os mesmos do editor de horário. Até
 * 2026-09-28 estavam escritos à mão em português, e um cliente com a app em
 * inglês via "Segunda … Fechado" por baixo de tudo o resto em inglês.
 */
export const AvisoLojaFechada = ({ periodos }: { periodos?: PeriodoHorario[] }) => {
  const { t } = useTranslation();
  const dias = t("businessHours.days", { returnObjects: true }) as string[];
  const temHorario = !!periodos?.length;

  return (
    <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
      <p className="text-sm font-semibold text-destructive">{t("businessDetail.closedNow")}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {temHorario ? t("businessDetail.closedBrowseHint") : t("businessDetail.notAcceptingNow")}
      </p>
      {temHorario && (
        // Grelha de duas colunas: a do dia ajusta-se ao dia mais comprido do
        // idioma ("Wednesday", "Mercredi"), e as horas ficam alinhadas.
        <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          {dias.map((nome, d) => {
            const ps = periodos!.filter((x) => x.weekday === d);
            return (
              <div key={d} className="contents" data-dia={d}>
                <span>{nome}</span>
                <span>
                  {ps.length === 0
                    ? t("businessHours.closed")
                    : ps.map((x) => `${x.opens_at}–${x.closes_at}`).join(" · ")}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
