import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

/**
 * Galeria do restaurante (Fase 2.5).
 *
 * REAPROVEITA `portfolio_images` e o bucket `portfolio`, que já existiam para a
 * vertical de beleza. A tabela é exactamente uma galeria com chave em
 * `profiles.id` e já tem as policies certas — dono gere a sua, toda a gente lê.
 * Criar uma tabela paralela só para restaurantes acrescentava uma segunda
 * verdade sobre a mesma coisa (§10: reaproveitar o que já existe).
 *
 * A leitura é pública de propósito: é a montra, e o cliente tem de a ver antes
 * de ter conta — como já vê o menu.
 */
interface Foto { id: string; image_url: string; caption: string | null }

const MAX_FOTOS = 12;
const MAX_BYTES = 5 * 1024 * 1024;

export const BusinessGallery = ({ businessId }: { businessId: string }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [aEnviar, setAEnviar] = useState(false);

  const { data: fotos = [], isLoading } = useQuery({
    queryKey: ["galeria", businessId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("portfolio_images")
        .select("id, image_url, caption")
        .eq("provider_id", businessId)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Foto[];
    },
  });

  const enviar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (file.size > MAX_BYTES) {
      toast.error(t("businessGallery.tooLarge"));
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    if (fotos.length >= MAX_FOTOS) {
      toast.error(t("businessGallery.maxReached", { max: MAX_FOTOS }));
      return;
    }
    setAEnviar(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${user.id}/loja/${Date.now()}.${ext}`;
      const up = await supabase.storage.from("portfolio").upload(path, file, { contentType: file.type });
      if (up.error) throw new Error(up.error.message);
      const { data: pub } = supabase.storage.from("portfolio").getPublicUrl(path);
      const ins = await supabase.from("portfolio_images").insert({
        provider_id: businessId, image_url: pub.publicUrl,
      });
      if (ins.error) throw new Error(ins.error.message);
      qc.invalidateQueries({ queryKey: ["galeria", businessId] });
      toast.success(t("businessGallery.added"));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setAEnviar(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const apagar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("portfolio_images").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["galeria", businessId] });
      toast.success(t("businessGallery.removed"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ImagePlus className="h-4 w-4" /> {t("businessGallery.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {t("businessGallery.hint")}
        </p>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : fotos.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("businessGallery.empty")}</p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {fotos.map((f) => (
              <div key={f.id} className="relative aspect-square overflow-hidden rounded-lg border">
                <img src={f.image_url} alt={f.caption ?? ""} loading="lazy"
                  className="h-full w-full object-cover" />
                <Button type="button" variant="destructive" size="icon"
                  className="absolute top-1 right-1 h-7 w-7"
                  onClick={() => apagar.mutate(f.id)} disabled={apagar.isPending}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={enviar} />
        <Button type="button" variant="outline" className="w-full h-12"
          onClick={() => fileRef.current?.click()}
          disabled={aEnviar || fotos.length >= MAX_FOTOS}>
          {aEnviar ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ImagePlus className="h-4 w-4 mr-2" />}
          {fotos.length >= MAX_FOTOS
            ? t("businessGallery.maxLabel", { max: MAX_FOTOS })
            : t("businessGallery.add")}
        </Button>
      </CardContent>
    </Card>
  );
};
