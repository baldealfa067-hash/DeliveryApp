import { IndependentDriverFinance, IndependentDriverPrices } from "@/components/IndependentDriverOperations";
import { lazy, Suspense, useEffect, useState, useRef } from "react";
import { BUCKET_PRIVADO } from "@/lib/armazenamentoPrivado";
import { AudioPrivado } from "@/components/MediaPrivada";
import { useNavigate } from "react-router-dom";
import {
  MapPin,
  Navigation,
  Package,
  CheckCircle2,
  Clock,
  Loader2,
  Phone,
  Power,
  PowerOff,
  Camera,
  Volume2,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import {
  useDriverProfile,
  useToggleAvailability,
  useAvailableDeliveries,
  useMyDeliveries,
  useAcceptDelivery,
  usePickupDelivery,
  useCompleteDelivery,
  useCreateDeliveryProof,
  useValidateDeliveryCode,
  useUpdateDeliveryTracking,
  useUpdateDriverLocation,
  type Delivery,
} from "@/hooks/useDrivers";

import { useDriverDeliveryStats, useDriverDailyStats } from "@/hooks/useDriverDeliveryStats";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { TrendingUp, Route } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "react-i18next";
import { LanguageSelector } from "@/components/LanguageSelector";
import { PanelHeader } from "@/components/PanelHeader";
import logo from "@/assets/itudoo-logo-preto.png";
import { DeliveryPayload } from "@/components/DeliveryPayload";
import { formatCFA } from "@/lib/format";
const DriverMap = lazy(() => import("@/components/DriverMap"));

/**
 * Qual das duas gravações responde a "onde vou buscar isto?".
 *
 * Um ENVIO traz a voz no próprio pedido, gravada pelo cliente no momento
 * (Fase 7.3). Um pedido de RESTAURANTE traz a do perfil da loja, a mesma em
 * todos os pedidos dela. Nunca há as duas: um envio não tem restaurante, e num
 * pedido de restaurante `pickup_voice_note_url` é sempre nulo.
 *
 * A do pedido vem primeiro de propósito. Se um dia um envio passar a ter loja,
 * a indicação que o cliente gravou para AQUELE envio vale mais que a morada
 * genérica do negócio.
 */
const vozDaRecolha = (d: Delivery): string | null =>
  d.pickup_voice_note_url ?? d.restaurant_voice_note_url ?? null;

const DriverDashboard = () => {
  const { t, i18n } = useTranslation();
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const { data: driver, isLoading: driverLoading } = useDriverProfile(user?.id ?? null);
  const toggleAvailability = useToggleAvailability();
  const { data: availableDeliveries = [] } = useAvailableDeliveries(!!driver);
  const { data: myDeliveries = [] } = useMyDeliveries(!!driver);
  const acceptDelivery = useAcceptDelivery();
  const pickupDelivery = usePickupDelivery();
  const completeDelivery = useCompleteDelivery();
  const updateTracking = useUpdateDeliveryTracking();
  const updateDriverLocation = useUpdateDriverLocation();

  const { data: deliveryStats } = useDriverDeliveryStats(driver?.id ?? null);
  const { data: dailyStats = [] } = useDriverDailyStats(driver?.id ?? null);

  const [proofDialogOpen, setProofDialogOpen] = useState(false);
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [codeLocked, setCodeLocked] = useState(false);
  const [codeDialogOpen, setCodeDialogOpen] = useState(false);
  const [codeDeliveryId, setCodeDeliveryId] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [codeError, setCodeError] = useState(false);
  const [driverPosition, setDriverPosition] = useState<{ lat: number; lng: number } | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const lastLocationPushRef = useRef(0);
  const createProof = useCreateDeliveryProof();
  const validateCode = useValidateDeliveryCode();

  // Auto-update location — must be before any early returns (Rules of Hooks)
  // Refs para o callback do GPS ler sempre o estado actual (ver o comentario
  // dentro do watchPosition) sem que o watch tenha de ser recriado.
  const minhasEntregasRef = useRef(myDeliveries);
  minhasEntregasRef.current = myDeliveries;
  const atualizarTrackingRef = useRef(updateTracking.mutate);
  atualizarTrackingRef.current = updateTracking.mutate;
  const atualizarPosicaoRef = useRef(updateDriverLocation.mutate);
  atualizarPosicaoRef.current = updateDriverLocation.mutate;

  const hasActiveDelivery = myDeliveries.some(d => ["aceite", "recolhido"].includes(d.status));
  const needsLocation = Boolean(driver?.is_available || hasActiveDelivery);
  useEffect(() => {
    if (!needsLocation) {
      setDriverPosition(null);
      return;
    }
    const watchId = navigator.geolocation?.watchPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setDriverPosition(coords);

        // Publicar a posicao mesmo sem entrega atribuida — e assim que a loja
        // sabe que motoristas tem por perto. watchPosition dispara muitas vezes,
        // por isso guardamos no maximo de 30 em 30 segundos.
        const now = Date.now();
        if (now - lastLocationPushRef.current > 30000) {
          lastLocationPushRef.current = now;
          atualizarPosicaoRef.current(coords);
        }

        // Le-se da REF, nao da variavel capturada. Este callback nasce quando o
        // motorista liga a disponibilidade -- nessa altura a lista de entregas
        // esta vazia -- e o efeito so volta a correr se a disponibilidade mudar.
        // Ao ler `myDeliveries` directamente, uma entrega aceite DEPOIS nunca era
        // vista: no fluxo normal (ligar -> aceitar) o tracking nunca era enviado e
        // o cliente nunca via o motorista a mexer-se (§52). Com a ref le-se
        // sempre a lista actual sem reiniciar o watchPosition.
        const deliveryId = minhasEntregasRef.current
          .find((d) => ["aceite", "recolhido"].includes(d.status))?.id ?? "";
        if (deliveryId) {
          atualizarTrackingRef.current({ ...coords, deliveryId });
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 10000 }
    );
    return () => {
      if (watchId !== undefined) navigator.geolocation?.clearWatch(watchId);
    };
  }, [needsLocation]);

  if (!loading && !user) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b">
          <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
            <img src={logo} alt="iTudoo" className="h-8 w-auto" />
            <LanguageSelector />
          </div>
        </header>
        <main className="max-w-2xl mx-auto px-4 py-6 flex flex-col items-center justify-center min-h-[60vh] text-center">
          <Navigation className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <h1 className="text-xl font-bold mb-2">{t("driverDashboard.registerTitle")}</h1>
          <Button onClick={() => navigate("/login?mode=cliente")}>{t("auth.loginTab")}</Button>
        </main>
      </div>
    );
  }

  if (loading || driverLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const compressImage = (file: File): Promise<string> =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const MAX = 800;
          const ratio = Math.min(MAX / img.width, MAX / img.height, 1);
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(img.width * ratio);
          canvas.height = Math.round(img.height * ratio);
          canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.7));
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    });

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const compressed = await compressImage(file);
    setPhotoPreview(compressed);
  };

  const handleProofSubmit = async () => {
    if (!selectedDeliveryId || !photoPreview) return;
    try {
      await createProof.mutateAsync({
        deliveryId: selectedDeliveryId,
        photoUrl: photoPreview,
      });
      await completeDelivery.mutateAsync(selectedDeliveryId);
      setProofDialogOpen(false);
      setPhotoPreview(null);
      setSelectedDeliveryId(null);
    } catch (err) {
      // Antes so ia para a consola: o motorista via o dialogo nao fechar e nao
      // sabia porque. Com a prova obrigatoria, esta mensagem e a unica pista.
      toast.error(err instanceof Error ? err.message : t("driverDashboard.proofRequired"));
      console.error("[driver] proof error:", err);
    }
  };


  const handleCodeValidate = async () => {
    if (!codeDeliveryId || codeInput.trim().length !== 6) return;
    try {
      const ok = await validateCode.mutateAsync({ deliveryId: codeDeliveryId, code: codeInput.trim() });
      if (ok) {
        setCodeDialogOpen(false);
        setCodeInput("");
        setCodeDeliveryId(null);
        setCodeError(false);
      } else {
        setCodeError(true);
      }
    } catch (err) {
      // Ao 5o erro o servidor bloqueia o codigo DESTA entrega. Dizer so "codigo
      // incorreto" deixava o motorista a tentar para sempre um codigo que ja
      // nunca vai passar -- a saida e a fotografia, e o ecra tem de o dizer.
      const msg = err instanceof Error ? err.message : String(err);
      if (/bloqueado/i.test(msg)) {
        setCodeLocked(true);
      } else {
        setCodeError(true);
      }
      console.error("[driver] code validate error:", err);
    }
  };

  const activeDeliveries = myDeliveries.filter(d => ["aceite", "recolhido"].includes(d.status));
  const activeDelivery = activeDeliveries[0];
  const completedDeliveries = myDeliveries.filter(d => d.status === "entregue")
    .sort((a, b) => Date.parse(b.delivered_at ?? b.created_at) - Date.parse(a.delivered_at ?? a.created_at));

  // Not registered
  if (!driver) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b">
          <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
            <img src={logo} alt="iTudoo" className="h-8 w-auto" />
            <LanguageSelector />
          </div>
        </header>
        <main className="max-w-2xl mx-auto px-4 py-6 flex flex-col items-center justify-center min-h-[60vh] text-center">
          <Navigation className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <h1 className="text-xl font-bold mb-2">{t("driverDashboard.registerTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("auth.partnerManagedByAdmin")}</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Saída para a app pública: um motorista navega e encomenda como
          qualquer pessoa (§9). */}
      <PanelHeader onLogout={() => signOut().then(() => navigate("/"))} />

      <main className="max-w-2xl mx-auto px-4 py-6 pb-[calc(env(safe-area-inset-bottom))]">
        {/* Driver Info + Availability Toggle */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold">{driver.name}</h1>
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              {t(`driverDashboard.vehicle.${driver.vehicle_type}`)}
              <Badge variant={driver.is_available ? "default" : "secondary"} className="ml-1 text-[10px]">
                {driver.is_available ? t("driverDashboard.available") : t("driverDashboard.offline")}
              </Badge>
            </p>
          </div>
          <Button
            variant={driver.is_available ? "destructive" : "default"}
            size="sm"
            onClick={() => toggleAvailability.mutate()}
            disabled={toggleAvailability.isPending}
            className="gap-1"
          >
            {driver.is_available ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
            {driver.is_available ? t("driverDashboard.goOffline") : t("driverDashboard.goOnline")}
          </Button>
        </div>

        {/* Stats — today */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <Card>
            <CardContent className="p-3 flex flex-col items-center gap-1">
              <Package className="h-5 w-5 text-primary" />
              <span className="text-2xl font-bold">{completedDeliveries.length}</span>
              <span className="text-[10px] text-muted-foreground text-center">{t("driverDashboard.delivered")}</span>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 flex flex-col items-center gap-1">
              <Clock className="h-5 w-5 text-yellow-600" />
              <span className="text-2xl font-bold">{activeDeliveries.length}</span>
              <span className="text-[10px] text-muted-foreground text-center">{t("driverDashboard.active")}</span>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 flex flex-col items-center gap-1">
              <Navigation className="h-5 w-5 text-success" />
              <span className="text-2xl font-bold">{availableDeliveries.length}</span>
              <span className="text-[10px] text-muted-foreground text-center">{t("driverDashboard.available")}</span>
            </CardContent>
          </Card>
        </div>

        {/* Extended stats — week, month, distance */}
        {deliveryStats && (
          <Card className="mb-4">
            <CardContent className="p-4 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <TrendingUp className="h-3.5 w-3.5" /> {t("driverDashboard.statsTitle")}
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center">
                  <p className="text-[10px] text-muted-foreground uppercase">{t("driverDashboard.today")}</p>
                  <p className="text-lg font-bold text-primary">{formatCFA(deliveryStats.today_earnings)}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {deliveryStats.today_count} {t("driverDashboard.deliveries")}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-muted-foreground uppercase">{t("driverDashboard.last7days")}</p>
                  <p className="text-lg font-bold text-primary">{formatCFA(deliveryStats.week_earnings)}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {deliveryStats.week_count} {t("driverDashboard.deliveries")}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-muted-foreground uppercase">{t("driverDashboard.thisMonth")}</p>
                  <p className="text-lg font-bold text-primary">{formatCFA(deliveryStats.month_earnings)}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {deliveryStats.month_count} {t("driverDashboard.deliveries")}
                  </p>
                </div>
              </div>

              {/* Km em linha secundaria: sao distancia em linha recta entre
                  restaurante e cliente, nao percurso medido. §40 diz para nao os
                  apresentar como se fossem precisos -- por isso nao competem com
                  o dinheiro, que esse e' exacto. */}
              <p className="text-[10px] text-muted-foreground flex items-center justify-center gap-1 pt-1">
                <Route className="h-3 w-3" />
                {t("driverDashboard.totalDistance")}: {deliveryStats.week_distance.toFixed(1)} km ({t("driverDashboard.last7days")})
              </p>
              {dailyStats.length > 0 && (
                <ResponsiveContainer width="100%" height={150}>
                  <BarChart data={dailyStats}>
                    <XAxis
                      dataKey="day"
                      tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { weekday: "short" })}
                      tick={{ fontSize: 10 }}
                    />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip
                      formatter={(v: number, name: string) => [v, name === "delivery_count" ? t("driverDashboard.deliveries") : "km"]}
                      labelFormatter={(v) => new Date(v).toLocaleDateString()}
                    />
                    <Bar dataKey="delivery_count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        )}

        {activeDelivery && (
          <Suspense fallback={null}>
            <DriverMap key={activeDelivery.id} driverPosition={driverPosition} activeDelivery={activeDelivery} />
          </Suspense>
        )}

        {activeDeliveries.map(delivery => (
          <Card key={delivery.id} className="mb-4 border-2 border-primary/50 bg-primary/5">
            <CardContent className="p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-primary mb-2">
                #{delivery.order_number ?? delivery.id.slice(0, 8)} ·
                {delivery.status === "aceite"
                  ? "🛵 " + t("driverDashboard.onTheWayToRestaurant")
                  : "📦 " + t("driverDashboard.onTheWayToCustomer")}
              </p>
              {/* Nome e morada por inteiro (a morada em duas linhas), e o botão de
                  ligar por baixo: lado a lado, o botão empurrava os dois para
                  reticências e o motorista não lia a morada toda. */}
              <div className="space-y-2">
                <div className="min-w-0">
                  <p className="text-base font-bold break-words">
                    {delivery.status === "aceite"
                      ? delivery.restaurant_name
                      : delivery.customer_name}
                  </p>
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {delivery.status === "aceite"
                      ? delivery.restaurant_address
                      : delivery.customer_address}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {delivery.restaurant_phone && (
                    <a href={`tel:${delivery.restaurant_phone.replace(/\s/g, "")}`}
                      className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-primary/10 px-3 text-sm font-medium text-primary">
                      <Phone className="h-4 w-4" /> {t("driverDashboard.callRestaurant")}
                    </a>
                  )}
                  {delivery.status === "recolhido" && delivery.customer_phone && (
                    <a href={`tel:${delivery.customer_phone.replace(/\s/g, "")}`}
                      className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-success-soft px-3 text-sm font-medium text-success-foreground">
                      <Phone className="h-4 w-4" /> {t("driverDashboard.callCustomer", "Ligar ao cliente")}
                    </a>
                  )}
                </div>
              </div>
              {/* Fase 7.3 — a voz da RECOLHA aparece ANTES da de entrega e some
                  depois de recolher: o motorista tem duas gravações e precisa
                  delas em momentos diferentes. Enquanto não recolheu, o sítio
                  que lhe interessa é a origem (§51 — nada desnecessário a
                  competir com a acção actual).

                  As duas fontes partilham este slot porque respondem à mesma
                  pergunta — "onde vou buscar isto?" — e nunca coexistem: um
                  envio tem `pickup_voice_note_url` e não tem restaurante; um
                  pedido de restaurante é o contrário. Dois blocos separados
                  davam ao motorista duas caixas para a mesma coisa, uma delas
                  sempre vazia. */}
              {vozDaRecolha(delivery) && delivery.status !== "recolhido" && (
                <BlocoVoz tom="recolha" etiqueta={t("driverDashboard.whereToPickUp")} refFicheiro={vozDaRecolha(delivery) as string} />
              )}
              {/* Voice note from customer */}
              {delivery.voice_note_url && (
                <BlocoVoz tom="entrega" etiqueta={t("driverDashboard.voiceDirectionFrom", { name: delivery.customer_name ?? t("driverDashboard.voiceDirection") })} refFicheiro={delivery.voice_note_url} />
              )}
              {/* Google Maps link */}
              {delivery.status === "recolhido" && delivery.customer_lat != null && delivery.customer_lng != null && (
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${delivery.customer_lat},${delivery.customer_lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 flex items-center justify-center gap-1.5 text-xs font-medium text-blue-600 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 px-2.5 py-2 rounded-md"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> {t("driverDashboard.openGoogleMaps")}
                </a>
              )}
              {delivery.status === "aceite" && delivery.restaurant_lat != null && delivery.restaurant_lng != null && (
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${delivery.restaurant_lat},${delivery.restaurant_lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 flex items-center justify-center gap-1.5 text-xs font-medium text-blue-600 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 px-2.5 py-2 rounded-md"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> {t("driverDashboard.openGoogleMaps")}
                </a>
              )}
              <DeliveryPayload items={delivery.items} orderTotal={delivery.order_total}
                deliveryFee={delivery.delivery_fee} paymentMethod={delivery.payment_method} paymentStatus={delivery.payment_status} />
              {delivery.status === "aceite" && (
                <Button onClick={() => pickupDelivery.mutate(delivery.id)} disabled={pickupDelivery.isPending} className="mt-3 h-12 w-full text-base">
                  {t("driverDashboard.pickup")}
                </Button>
              )}
              {delivery.status === "recolhido" && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button onClick={() => {
                    setCodeDeliveryId(delivery.id);
                    setCodeInput("");
                    setCodeError(false);
                    setCodeDialogOpen(true);
                  }} className="h-12 gap-1.5 text-base">
                    <CheckCircle2 className="h-4 w-4" /> {t("driverDashboard.enterCode")}
                  </Button>
                  <Button variant="outline" onClick={() => {
                    setSelectedDeliveryId(delivery.id);
                    setProofDialogOpen(true);
                  }} className="h-12 gap-1.5 text-base">
                    <Camera className="h-4 w-4" /> {t("driverDashboard.proof")}
                  </Button>
                  {/* Fase 9.3: o botao "Sem codigo" saiu. Concluia a entrega sem
                      deixar rasto nenhum, e o backend passou a recusar esse
                      caminho de qualquer forma. Ficam as duas saidas com
                      prova: o codigo do cliente, ou uma fotografia. */}
                </div>
              )}
            </CardContent>
          </Card>
        ))}

        {/* Tabs */}
        <Tabs defaultValue="available">
          <TabsList className="w-full flex-wrap justify-start h-auto p-1 bg-muted/50">
            <TabsTrigger value="available" className="gap-1.5 text-xs">
              <Navigation className="h-3.5 w-3.5" />
              {t("driverDashboard.availableDeliveries")}
              {availableDeliveries.length > 0 && (
                <Badge className="ml-1 h-4 min-w-[16px] text-[9px] px-1">{availableDeliveries.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-1.5 text-xs">
              <Package className="h-3.5 w-3.5" />
              {t("driverDashboard.myDeliveries")}
            </TabsTrigger>
            {driver.fleet_id === null && (
              <>
                <TabsTrigger value="prices" className="text-xs">{t("fleetDashboard.tabPrices")}</TabsTrigger>
                <TabsTrigger value="finance" className="text-xs">{t("fleetDashboard.tabFinance")}</TabsTrigger>
              </>
            )}
          </TabsList>

          {driver.fleet_id === null && (
            <>
              <TabsContent value="prices"><IndependentDriverPrices driverId={driver.id} /></TabsContent>
              <TabsContent value="finance"><IndependentDriverFinance driverId={driver.id} /></TabsContent>
            </>
          )}

          <TabsContent value="available">
            {availableDeliveries.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                {t("driverDashboard.noAvailable")}
              </div>
            ) : (
              <div className="flex flex-col gap-3 mt-3">
                {availableDeliveries.map((d) => (
                  <Card key={d.id}>
                    {/* O botão vai POR BAIXO, a toda a largura. Numa coluna à
                        direita ocupava a altura toda do cartão e deixava o
                        conteúdo espremido, com as moradas cortadas. */}
                    <CardContent className="p-3">
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-base font-bold break-words">{d.restaurant_name}</p>
                        <p className="line-clamp-2 text-sm text-muted-foreground">📍 {d.restaurant_address ?? t("driverDashboard.notAvailable")}</p>
                        <p className="line-clamp-2 text-sm text-muted-foreground">🏠 {d.customer_address ?? t("driverDashboard.notAvailable")}</p>
                        {d.distance_km && (
                          <p className="text-sm text-muted-foreground">↔ {d.distance_km.toFixed(1)} km</p>
                        )}
                      </div>
                      <DeliveryPayload
                        items={d.items}
                        orderTotal={d.order_total}
                        deliveryFee={d.delivery_fee}
                        paymentMethod={d.payment_method}
                        paymentStatus={d.payment_status}
                      />
                      <Button
                        onClick={() => acceptDelivery.mutate(d.id)}
                        disabled={acceptDelivery.isPending}
                        className="mt-3 h-12 w-full text-base"
                      >
                        {t("driverDashboard.accept")}
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="history">
            {completedDeliveries.length === 0 ? (
              <div className="mt-3 rounded-xl border border-dashed bg-card px-4 py-8 text-center">
                <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">{t("driverDashboard.noCompletedDeliveries")}</p>
              </div>
            ) : (
              <ul className="mt-3 space-y-2">
                {completedDeliveries.map(delivery => (
                  <li key={delivery.id} className="flex items-start gap-3 rounded-xl border bg-card p-3 shadow-card">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-success-soft text-success-foreground">
                      <CheckCircle2 className="size-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">#{delivery.order_number ?? delivery.id.slice(0, 8)}</p>
                      {delivery.customer_name && <p className="break-words text-sm text-muted-foreground">{delivery.customer_name}</p>}
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold text-success-foreground">{t("driverDashboard.delivered")}</p>
                      {delivery.delivered_at && (
                        <time dateTime={delivery.delivered_at} className="text-xs text-muted-foreground">
                          {new Date(delivery.delivered_at).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" })}
                        </time>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </main>

      {/* Code Validation Dialog */}
      <Dialog open={codeDialogOpen} onOpenChange={(open) => { setCodeDialogOpen(open); if (!open) { setCodeInput(""); setCodeError(false); setCodeDeliveryId(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("driverDashboard.codeTitle", "Código de entrega")}</DialogTitle>
            <DialogDescription>{t("driverDashboard.codeDesc", "Pede ao cliente o código de 6 dígitos que aparece na app dele.")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <Input
              type="number"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={codeInput}
              onChange={(e) => { setCodeInput(e.target.value.slice(0, 6)); setCodeError(false); }}
              className="text-center text-2xl tracking-widest font-bold h-14"
            />
            {codeError && !codeLocked && (
              <p className="text-sm text-destructive text-center">{t("driverDashboard.codeError")}</p>
            )}
            {codeLocked && (
              <div className="space-y-2 text-center">
                <p className="text-sm text-destructive">{t("driverDashboard.codeLocked")}</p>
                <Button variant="outline" className="w-full h-11" onClick={() => {
                  setSelectedDeliveryId(codeDeliveryId);
                  setCodeDialogOpen(false);
                  setCodeLocked(false);
                  setProofDialogOpen(true);
                }}>
                  <Camera className="h-4 w-4 mr-2" />{t("driverDashboard.useProofInstead")}
                </Button>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={handleCodeValidate} disabled={codeInput.trim().length !== 6 || validateCode.isPending}>
              {validateCode.isPending ? t("common.saving") : t("driverDashboard.codeValidate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Photo Proof Dialog */}
      <Dialog open={proofDialogOpen} onOpenChange={(open) => { setProofDialogOpen(open); if (!open) { setPhotoPreview(null); setSelectedDeliveryId(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("driverDashboard.proofTitle")}</DialogTitle>
            <DialogDescription>{t("driverDashboard.proofDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handlePhotoUpload}
            />
            {photoPreview ? (
              <img src={photoPreview} alt="Preview" className="w-full max-h-60 object-contain rounded-lg" />
            ) : (
              <Button variant="outline" onClick={() => photoInputRef.current?.click()} className="gap-2">
                <Camera className="h-4 w-4" /> {t("driverDashboard.takePhoto")}
              </Button>
            )}
          </div>
          <DialogFooter>
            <Button onClick={handleProofSubmit} disabled={!photoPreview || createProof.isPending}>
              {createProof.isPending ? t("common.saving") : t("driverDashboard.submitProof")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
};

/** Uma indicação de voz no painel do motorista: a etiqueta numa linha e o
 *  leitor (um botão) por baixo, com a largura toda. Lado a lado, num ecrã de
 *  390px a etiqueta — que não encolhe — espremia o leitor contra a margem. */
const BlocoVoz = ({ tom, etiqueta, refFicheiro }: { tom: "recolha" | "entrega"; etiqueta: string; refFicheiro: string }) => (
  <div
    className={
      tom === "recolha"
        ? "mt-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2.5"
        : "mt-2 rounded-lg border border-pending/40 bg-pending-soft px-3 py-2.5"
    }
  >
    <p
      className={`mb-2 flex items-start gap-1.5 text-caption font-medium ${
        tom === "recolha" ? "text-primary" : "text-pending-foreground"
      }`}
    >
      <Volume2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">{etiqueta}</span>
    </p>
    <AudioPrivado bucket={BUCKET_PRIVADO.notasVoz} refFicheiro={refFicheiro} className="w-full" />
  </div>
);

export default DriverDashboard;
