import { lazy, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, FileText, Loader2, MapPin, Package, PackageOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { VoiceRecorderField } from "@/components/VoiceRecorderField";
import type { AcabadoDeCriar } from "@/components/OrderPlacedDialog";
import { useAuth } from "@/hooks/useAuth";
import { useBairros } from "@/hooks/useBairros";
import { useGeolocation, type GeoPosition } from "@/hooks/useGeolocation";
import { useDeliveryPrice, useCreateSendOrder, type TipoEnvio } from "@/hooks/useSendOrder";
import { formatCFA } from "@/lib/format";

const DeliveryLocationMap = lazy(() => import("@/components/DeliveryLocationMap"));

/**
 * Enviar um documento ou objecto (§19).
 *
 * A ORDEM DO ECRÃ segue a ordem da decisão, não a da base de dados: o quê,
 * de onde, para onde, quanto custa, confirmar. O preço aparece **antes** do
 * botão e depende só do bairro de destino — §14 diz que o cliente aceita um
 * preço, e §83 que não pode haver surpresas no fim.
 *
 * As DUAS gravações de voz não são decoração. Num envio a origem é escolhida
 * pelo cliente e é muitas vezes o sítio mais difícil de explicar por escrito —
 * "a casa a seguir à bomba, pergunta pelo Sr. Mané". §21 põe a voz acima do
 * mapa, e §78 diz que uma referência local vale mais que um número de porta.
 *
 * Os dois pontos no mapa permitem confirmar a recolha e a entrega no local.
 */
const TIPOS: { valor: TipoEnvio; chave: string; icone: typeof FileText }[] = [
  { valor: "documento", chave: "sendPage.typeDocument", icone: FileText },
  { valor: "objeto", chave: "sendPage.typeObject", icone: Package },
  { valor: "outro", chave: "sendPage.typeOther", icone: PackageOpen },
];

const SendPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { data: bairros = [] } = useBairros();
  const geo = useGeolocation();
  const criar = useCreateSendOrder();

  const [tipo, setTipo] = useState<TipoEnvio>("documento");
  const [descricao, setDescricao] = useState("");
  const [recolhaReferencia, setRecolhaReferencia] = useState("");
  const [recolhaBairro, setRecolhaBairro] = useState<string>("");
  const [recolhaVoz, setRecolhaVoz] = useState<string | null>(null);
  const [recolhaPonto, setRecolhaPonto] = useState<GeoPosition | null>(null);
  const [mapaRecolhaAberto, setMapaRecolhaAberto] = useState(false);
  const [destinoReferencia, setDestinoReferencia] = useState("");
  const [destinoBairro, setDestinoBairro] = useState<string>("");
  const [destinoVoz, setDestinoVoz] = useState<string | null>(null);
  const [destinoPonto, setDestinoPonto] = useState<GeoPosition | null>(null);
  const [mapaDestinoAberto, setMapaDestinoAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");

  const { data: preco, isLoading: aCarregarPreco } = useDeliveryPrice(destinoBairro || null);

  useEffect(() => {
    if (!loading && !user) navigate("/login", { replace: true });
  }, [user, loading, navigate]);

  // Preenche nome e telefone do perfil, para não os pedir outra vez.
  useEffect(() => {
    if (!user?.id) return;
    void (async () => {
      const { data } = await supabase
        .from("profiles").select("name, phone").eq("user_id", user.id).maybeSingle();
      if (data?.name && !nome) setNome(data.name);
      if (data?.phone && !telefone) setTelefone(data.phone);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const pontoRecolha = recolhaPonto ?? geo.position;
  const podeEnviar = Boolean(recolhaBairro && destinoBairro && telefone.trim() && preco
    && pontoRecolha && destinoPonto);

  const submeter = () => {
    if (!podeEnviar || criar.isPending) return;
    criar.mutate(
      {
        tipo, descricao,
        recolhaMorada: [recolhaBairro, recolhaReferencia.trim()].filter(Boolean).join(" - "),
        recolhaBairro,
        recolhaVoz,
        recolhaLat: pontoRecolha?.lat ?? null,
        recolhaLng: pontoRecolha?.lng ?? null,
        destinoMorada: [destinoBairro, destinoReferencia.trim()].filter(Boolean).join(" - "),
        destinoBairro,
        destinoVoz,
        destinoLat: destinoPonto?.lat ?? null,
        destinoLng: destinoPonto?.lng ?? null,
        nome: nome.trim() || t("sendPage.defaultName"),
        telefone: telefone.trim(),
      },
      {
        // A confirmação é o OrderPlacedDialog, já no ecrã do envio.
        onSuccess: (r) => navigate(`/pedido/${r.order_id}`, {
          state: { criado: true, repetido: !!r.repetido } satisfies AcabadoDeCriar,
        }),
        onError: (e) => toast.error(e.message),
      },
    );
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>;
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-6 pb-8 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label={t("common.back")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">{t("sendPage.title")}</h1>
          <p className="text-xs text-muted-foreground">{t("sendPage.subtitle")}</p>
        </div>
      </div>

      {/* 1. O quê */}
      <Card><CardContent className="p-4 space-y-3">
        <Label>{t("sendPage.whatToSend")}</Label>
        <div className="grid grid-cols-3 gap-2">
          {TIPOS.map(({ valor, chave, icone: Icone }) => (
            <Button key={valor} type="button" variant={tipo === valor ? "default" : "outline"}
              className="h-16 flex-col gap-1" onClick={() => setTipo(valor)}>
              <Icone className="h-5 w-5" />
              <span className="text-xs">{t(chave)}</span>
            </Button>
          ))}
        </div>
        <Textarea placeholder={t("sendPage.describePlaceholder")}
          value={descricao} onChange={(e) => setDescricao(e.target.value)} className="min-h-16" />
      </CardContent></Card>

      {/* 2. De onde */}
      <Card><CardContent className="p-4 space-y-3">
        <Label className="flex items-center gap-2"><MapPin className="h-4 w-4" />{t("sendPage.pickupWhere")}</Label>
        <Select value={recolhaBairro} onValueChange={setRecolhaBairro}>
          <SelectTrigger className="h-12" aria-label={t("sendPage.pickupBairro")} aria-required="true">
            <SelectValue placeholder={t("sendPage.pickupBairro")} />
          </SelectTrigger>
          <SelectContent>
            {bairros.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input className="h-12" placeholder={t("sendPage.optionalReference")}
          aria-label={t("sendPage.pickupReference")}
          value={recolhaReferencia} onChange={e => setRecolhaReferencia(e.target.value)} />
        <div className="space-y-2">
          <Button type="button" variant="outline" aria-expanded={mapaRecolhaAberto}
            onClick={() => setMapaRecolhaAberto(open => !open)}>
            <MapPin aria-hidden="true" />
            {t("sendPage.pickupMap")} *
          </Button>
          {pontoRecolha && <p className="text-sm text-muted-foreground">{t("businessDetail.mapPointSelected")}</p>}
          {mapaRecolhaAberto && (
            <div className="isolate space-y-2">
              <p className="text-sm text-muted-foreground">{t("sendPage.pickupMapHint")}</p>
              <Suspense fallback={<div className="h-56 animate-pulse rounded-lg bg-muted" />}>
                <DeliveryLocationMap position={pontoRecolha} onSelect={setRecolhaPonto} />
              </Suspense>
              <Button type="button" variant="outline" disabled={geo.loading} onClick={() => {
                setRecolhaPonto(null);
                geo.detect();
              }}>
                {t("businessDetail.mapUseMyLocation")}
              </Button>
              {geo.error && <p role="status" className="text-sm text-muted-foreground">{geo.error}</p>}
            </div>
          )}
        </div>
        <VoiceRecorderField
          titulo={t("sendPage.pickupVoiceTitle")}
          ajuda={t("sendPage.pickupVoiceHelp")}
          valor={recolhaVoz} aoMudar={setRecolhaVoz} pasta="envios/recolha"
        />
      </CardContent></Card>

      {/* 3. Para onde — é este bairro que decide o preço */}
      <Card><CardContent className="p-4 space-y-3">
        <Label className="flex items-center gap-2"><MapPin className="h-4 w-4" />{t("sendPage.dropWhere")}</Label>
        <Select value={destinoBairro} onValueChange={setDestinoBairro}>
          <SelectTrigger className="h-12" aria-label={t("sendPage.dropBairro")} aria-required="true">
            <SelectValue placeholder={t("sendPage.dropBairro")} />
          </SelectTrigger>
          <SelectContent>
            {bairros.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input className="h-12" placeholder={t("sendPage.optionalReference")}
          aria-label={t("sendPage.dropReference")}
          value={destinoReferencia} onChange={e => setDestinoReferencia(e.target.value)} />
        <div className="space-y-2">
          <Button type="button" variant="outline" aria-expanded={mapaDestinoAberto}
            onClick={() => setMapaDestinoAberto(open => !open)}>
            <MapPin aria-hidden="true" />
            {t("businessDetail.deliveryMap")}
          </Button>
          {destinoPonto && (
            <p role="status" className="text-sm text-muted-foreground">{t("businessDetail.mapPointSelected")}</p>
          )}
          {mapaDestinoAberto && (
            <div className="isolate space-y-2">
              <p className="text-sm text-muted-foreground">{t("businessDetail.mapPinHint")}</p>
              <Suspense fallback={<div className="h-56 animate-pulse rounded-lg bg-muted" />}>
                <DeliveryLocationMap position={destinoPonto} onSelect={setDestinoPonto} />
              </Suspense>
              {destinoPonto && (
                <Button type="button" variant="ghost" onClick={() => setDestinoPonto(null)}>
                  {t("businessDetail.mapClearPoint")}
                </Button>
              )}
            </div>
          )}
        </div>
        <VoiceRecorderField
          titulo={t("sendPage.dropVoiceTitle")}
          ajuda={t("sendPage.dropVoiceHelp")}
          valor={destinoVoz} aoMudar={setDestinoVoz} pasta="envios/entrega"
        />
      </CardContent></Card>

      {/* 4. Contacto */}
      <Card><CardContent className="p-4 space-y-2">
        <Label>{t("sendPage.contact")}</Label>
        <Input className="h-12" placeholder={t("sendPage.yourName")} value={nome}
          onChange={(e) => setNome(e.target.value)} />
        <Input className="h-12" inputMode="tel" placeholder={t("sendPage.phonePlaceholder")}
          value={telefone} onChange={(e) => setTelefone(e.target.value)} />
      </CardContent></Card>

      {/* 5. O preço, ANTES do botão (§14, §83) */}
      <Card className={preco ? "border-primary/30 bg-primary/5" : undefined}>
        <CardContent className="p-4">
          {!destinoBairro ? (
            <p className="text-sm text-muted-foreground">{t("sendPage.pickBairroToSeePrice")}</p>
          ) : aCarregarPreco ? (
            <p className="text-sm text-muted-foreground">{t("sendPage.loadingPrice")}</p>
          ) : preco ? (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm text-muted-foreground">{t("sendPage.deliveryPrice")}</span>
                <span className="text-2xl font-bold">{formatCFA(preco.preco)}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {t("sendPage.byFleet", { fleet: preco.fleet_name })}
              </p>
            </>
          ) : (
            <p className="text-sm text-destructive">
              {t("sendPage.noFleet", { bairro: destinoBairro })}
            </p>
          )}
        </CardContent>
      </Card>

      {(!pontoRecolha || !destinoPonto) && (
        <p className="text-sm text-muted-foreground">{t("sendPage.mapPointsRequired")}</p>
      )}
      <Button className="w-full h-14 text-base" disabled={!podeEnviar || criar.isPending}
        onClick={submeter}>
        {criar.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        {preco ? t("sendPage.confirmWithPrice", { price: formatCFA(preco.preco) }) : t("sendPage.confirm")}
      </Button>
    </div>
  );
};

export default SendPage;
