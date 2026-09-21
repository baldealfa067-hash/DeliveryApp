import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Volume2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VoiceRecorderField } from "@/components/VoiceRecorderField";
import { BUCKET_PRIVADO } from "@/lib/armazenamentoPrivado";

/**
 * Indicação de voz de onde o negócio fica.
 *
 * Grava-se UMA vez, aqui no perfil, e passa a servir todos os pedidos do
 * restaurante. Até agora a única voz de recolha era a dos envios (Fase 7.3),
 * gravada pelo cliente a cada pedido — um pedido de restaurante não tinha voz
 * de origem nenhuma e o motorista só tinha a morada, que em Bissau é
 * precisamente o que não chega (§21, §78).
 *
 * Não é obrigatório: sem gravação o motorista não ouve nada dessa parte, sem
 * erro e sem bloquear o pedido. Mesmo default seguro do horário.
 *
 * Não se escreve por UPDATE directo em `profiles`. A coluna passa por
 * `set_business_location_voice`, que valida que o ficheiro é da pasta do
 * próprio: senão, um restaurante punha lá o nome da nota de voz de outro
 * cliente e os motoristas dele passavam a ouvir a morada falada de um estranho.
 */
const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string, args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export const BusinessLocationVoice = ({ businessId }: { businessId: string }) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [ref, setRef] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["voz-localizacao", businessId],
    queryFn: async () => {
      const { data, error } = await rpc("get_my_profile_private");
      if (error) throw new Error(error.message);
      const linha = ((data as { location_voice_url: string | null }[]) ?? [])[0];
      return linha?.location_voice_url ?? null;
    },
  });

  useEffect(() => { setRef(data ?? null); }, [data]);

  /**
   * O `VoiceRecorderField` já enviou o ficheiro quando nos chama. Aqui só se
   * aponta a coluna e se apaga o anterior — por esta ordem. Ao contrário, um
   * ficheiro apagado com a coluna ainda a apontar-lhe deixava o motorista com
   * um leitor partido em vez de silêncio.
   */
  const gravar = async (novo: string | null) => {
    const antes = ref;
    setRef(novo);
    const { data, error } = await rpc("set_business_location_voice", {
      p_business_id: businessId, p_ref: novo,
    });
    if (error) {
      setRef(antes);
      toast.error(error.message);
      return;
    }
    const anterior = data as string | null;
    if (anterior) {
      // Substituir, não acumular. Se falhar, fica um ficheiro sem referência no
      // bucket privado — mau, mas muito melhor que perder a gravação nova.
      await supabase.storage.from(BUCKET_PRIVADO.notasVoz).remove([anterior]);
    }
    qc.invalidateQueries({ queryKey: ["voz-localizacao", businessId] });
    toast.success(novo ? t("locationVoice.saved") : t("locationVoice.removed"));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Volume2 className="h-4 w-4" /> {t("locationVoice.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{t("locationVoice.intro")}</p>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <VoiceRecorderField
            titulo={t("locationVoice.fieldTitle")}
            ajuda={t("locationVoice.fieldHelp")}
            valor={ref}
            aoMudar={(v) => void gravar(v)}
            pasta="negocio/localizacao"
          />
        )}
      </CardContent>
    </Card>
  );
};
