import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useUrlPrivado, type BucketPrivado } from "@/lib/armazenamentoPrivado";
import { VoicePlayer } from "@/components/VoicePlayer";

/** Áudio de um bucket privado: pede o URL assinado ao Storage, que decide se quem
 *  está a ver pode ouvir. Sem permissão ou sem rede, diz que não abriu.
 *  Toca num `VoicePlayer` (um botão), não no `<audio controls>` nativo, que no
 *  telemóvel escondia o "play" atrás de um menu de três pontos. */
export const AudioPrivado = ({
  bucket,
  refFicheiro,
  className,
}: {
  bucket: BucketPrivado;
  refFicheiro: string;
  className?: string;
}) => {
  const { t } = useTranslation();
  const { data: url, isLoading, isError } = useUrlPrivado(bucket, refFicheiro);
  if (isLoading) return <Skeleton className={cn("h-12 flex-1 min-w-0 rounded-full", className)} />;
  if (isError || !url) return <span className="text-caption text-muted-foreground">{t("common.mediaUnavailable")}</span>;
  return <VoicePlayer src={url} className={className} />;
};

/** Imagem de um bucket privado. `onAbrir` recebe o URL assinado (não o caminho),
 *  para a pré-visualização em grande não ter de o pedir outra vez. */
export const ImagemPrivada = ({
  bucket,
  refFicheiro,
  alt,
  className,
  onAbrir,
}: {
  bucket: BucketPrivado;
  refFicheiro: string;
  alt: string;
  className?: string;
  onAbrir?: (url: string) => void;
}) => {
  const { t } = useTranslation();
  const { data: url, isLoading, isError } = useUrlPrivado(bucket, refFicheiro);
  if (isLoading) return <Skeleton className="h-32 w-full rounded-md" />;
  if (isError || !url) return <p className="text-caption text-muted-foreground">{t("common.mediaUnavailable")}</p>;
  const img = <img src={url} alt={alt} className={className} />;
  return onAbrir ? (
    <button type="button" onClick={() => onAbrir(url)} className="block w-full">
      {img}
    </button>
  ) : (
    img
  );
};
