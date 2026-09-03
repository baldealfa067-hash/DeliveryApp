import { useEffect, useState, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  LogOut,
  Settings,
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
  QrCode,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  useRegisterDriver,
  useToggleAvailability,
  useAvailableDeliveries,
  useMyDeliveries,
  useAcceptDelivery,
  usePickupDelivery,
  useCompleteDelivery,
  useCreateDeliveryProof,
  useValidateDeliveryQR,
  useUpdateDeliveryTracking,
} from "@/hooks/useDrivers";
import { QRCode } from "@/components/QRCode";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "react-i18next";
import { LanguageSelector } from "@/components/LanguageSelector";

const DriverDashboard = () => {
  const { t } = useTranslation();
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const { data: driver, isLoading: driverLoading } = useDriverProfile(user?.id ?? null);
  const registerDriver = useRegisterDriver();
  const toggleAvailability = useToggleAvailability();
  const { data: availableDeliveries = [] } = useAvailableDeliveries();
  const { data: myDeliveries = [] } = useMyDeliveries();
  const acceptDelivery = useAcceptDelivery();
  const pickupDelivery = usePickupDelivery();
  const completeDelivery = useCompleteDelivery();
  const updateTracking = useUpdateDeliveryTracking();

  const [registerOpen, setRegisterOpen] = useState(false);
  const [regName, setRegName] = useState("");
  const [regPhone, setRegPhone] = useState("");
  const [regVehicle, setRegVehicle] = useState("moto");
  const [proofDialogOpen, setProofDialogOpen] = useState(false);
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [qrDeliveryId, setQrDeliveryId] = useState<string | null>(null);
  const [qrOrderId, setQrOrderId] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const createProof = useCreateDeliveryProof();
  const validateQR = useValidateDeliveryQR();

  useEffect(() => {
    if (!loading && !user) navigate("/login", { replace: true });
  }, [user, loading, navigate]);

  // Auto-update location
  useEffect(() => {
    if (!driver?.is_available) return;
    const watchId = navigator.geolocation?.watchPosition(
      (pos) => {
        updateTracking.mutate({ lat: pos.coords.latitude, lng: pos.coords.longitude, deliveryId: "" });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 10000 }
    );
    return () => {
      if (watchId !== undefined) navigator.geolocation?.clearWatch(watchId);
    };
  }, [driver?.is_available]);

  if (loading || driverLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const handleRegister = async () => {
    if (!regName.trim() || !regPhone.trim()) return;
    try {
      await registerDriver.mutateAsync({ name: regName.trim(), phone: regPhone.trim(), vehicleType: regVehicle });
      setRegisterOpen(false);
    } catch (err) {
      console.error("[driver] register error:", err);
    }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleProofSubmit = async () => {
    if (!selectedDeliveryId || !photoPreview) return;
    try {
      await createProof.mutateAsync({
        deliveryId: selectedDeliveryId,
        photoUrl: photoPreview,
      });
      setProofDialogOpen(false);
      setPhotoPreview(null);
      setSelectedDeliveryId(null);
    } catch (err) {
      console.error("[driver] proof error:", err);
    }
  };

  const handleQRValidate = async () => {
    if (!qrDeliveryId || !qrOrderId) return;
    try {
      const ok = await validateQR.mutateAsync({ deliveryId: qrDeliveryId, orderId: qrOrderId });
      if (ok) setQrDialogOpen(false);
    } catch (err) {
      console.error("[driver] qr error:", err);
    }
  };

  const activeDelivery = myDeliveries.find((d) => ["aceite", "recolhido"].includes(d.status));
  const pendingDeliveries = myDeliveries.filter((d) => d.status === "aceite");
  const completedToday = myDeliveries.filter((d) => d.status === "entregue").length;

  // Not registered
  if (!driver) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b">
          <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground p-2 -m-2 rounded-md">
              <ArrowLeft className="h-4 w-4" /> {t("common.home")}
            </Link>
            <LanguageSelector />
          </div>
        </header>
        <main className="max-w-2xl mx-auto px-4 py-6 flex flex-col items-center justify-center min-h-[60vh] text-center">
          <Navigation className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <h1 className="text-xl font-bold mb-2">{t("driverDashboard.registerTitle")}</h1>
          <p className="text-sm text-muted-foreground mb-6">{t("driverDashboard.registerDesc")}</p>
          <Button onClick={() => setRegisterOpen(true)} className="gap-2">
            <Settings className="h-4 w-4" /> {t("driverDashboard.register")}
          </Button>

          <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("driverDashboard.registerTitle")}</DialogTitle>
                <DialogDescription>{t("driverDashboard.registerDesc")}</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="grid gap-2">
                  <Label>{t("common.name")}</Label>
                  <Input value={regName} onChange={(e) => setRegName(e.target.value)} placeholder={t("driverDashboard.namePlaceholder")} />
                </div>
                <div className="grid gap-2">
                  <Label>{t("common.phone")}</Label>
                  <Input type="tel" value={regPhone} onChange={(e) => setRegPhone(e.target.value)} placeholder={t("driverDashboard.phonePlaceholder")} />
                </div>
                <div className="grid gap-2">
                  <Label>{t("driverDashboard.vehicleType")}</Label>
                  <div className="flex gap-2">
                    {["moto", "bicicleta", "carro", "pe"].map((v) => (
                      <Button key={v} size="sm" variant={regVehicle === v ? "default" : "outline"} onClick={() => setRegVehicle(v)}>
                        {t(`driverDashboard.vehicle.${v}`)}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleRegister} disabled={registerDriver.isPending || !regName.trim() || !regPhone.trim()}>
                  {registerDriver.isPending ? t("common.saving") : t("common.confirm")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground p-2 -m-2 rounded-md">
            <ArrowLeft className="h-4 w-4" /> {t("common.home")}
          </Link>
          <div className="flex items-center gap-2">
            <LanguageSelector />
            <Button variant="ghost" size="sm" onClick={() => signOut().then(() => navigate("/"))} className="gap-1 min-h-11">
              <LogOut className="h-4 w-4" /> {t("common.logout")}
            </Button>
          </div>
        </div>
      </header>

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

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <Card>
            <CardContent className="p-3 flex flex-col items-center gap-1">
              <Package className="h-5 w-5 text-primary" />
              <span className="text-2xl font-bold">{completedToday}</span>
              <span className="text-[10px] text-muted-foreground text-center">{t("driverDashboard.delivered")}</span>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 flex flex-col items-center gap-1">
              <Clock className="h-5 w-5 text-yellow-600" />
              <span className="text-2xl font-bold">{pendingDeliveries.length}</span>
              <span className="text-[10px] text-muted-foreground text-center">{t("driverDashboard.active")}</span>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 flex flex-col items-center gap-1">
              <Navigation className="h-5 w-5 text-green-600" />
              <span className="text-2xl font-bold">{availableDeliveries.length}</span>
              <span className="text-[10px] text-muted-foreground text-center">{t("driverDashboard.available")}</span>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="available">
          <TabsList className="w-full justify-start h-auto p-1 bg-muted/50">
            <TabsTrigger value="available" className="gap-1.5 text-xs">
              <Navigation className="h-3.5 w-3.5" />
              {t("driverDashboard.availableDeliveries")}
              {availableDeliveries.length > 0 && (
                <Badge className="ml-1 h-4 min-w-[16px] text-[9px] px-1">{availableDeliveries.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="active" className="gap-1.5 text-xs">
              <Package className="h-3.5 w-3.5" />
              {t("driverDashboard.myDeliveries")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="available">
            {availableDeliveries.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                {t("driverDashboard.noAvailable")}
              </div>
            ) : (
              <div className="flex flex-col gap-3 mt-3">
                {availableDeliveries.map((d) => (
                  <Card key={d.id}>
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold">{d.restaurant_name}</p>
                          <p className="text-xs text-muted-foreground truncate">📍 {d.restaurant_address ?? t("driverDashboard.notAvailable")}</p>
                          <p className="text-xs text-muted-foreground truncate">🏠 {d.customer_address ?? t("driverDashboard.notAvailable")}</p>
                          {d.distance_km && (
                            <p className="text-xs text-muted-foreground mt-1">↔ {d.distance_km.toFixed(1)} km</p>
                          )}
                        </div>
                        <Button
                          size="sm"
                          onClick={() => acceptDelivery.mutate(d.id)}
                          disabled={acceptDelivery.isPending}
                          className="gap-1 shrink-0"
                        >
                          {t("driverDashboard.accept")}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="active">
            {myDeliveries.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                {t("driverDashboard.noDeliveries")}
              </div>
            ) : (
              <div className="flex flex-col gap-3 mt-3">
                {myDeliveries.map((d) => (
                  <Card key={d.id}>
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-bold">#{d.order_number}</span>
                            <Badge variant="secondary" className="text-[10px]">{t(`orderStatus.${d.status}`, d.status)}</Badge>
                          </div>
                          <p className="text-sm font-medium">{d.customer_name}</p>
                          <p className="text-xs text-muted-foreground truncate">🏠 {d.customer_address}</p>
                          {d.restaurant_phone && (
                            <a href={`tel:${d.restaurant_phone.replace(/\s/g, "")}`} className="text-xs text-primary flex items-center gap-1 mt-1">
                              <Phone className="h-3 w-3" /> {t("driverDashboard.callRestaurant")}
                            </a>
                          )}
                        </div>
                        <div className="flex flex-col gap-1.5 shrink-0">
                          {d.status === "aceite" && (
                            <Button size="sm" onClick={() => pickupDelivery.mutate(d.id)} disabled={pickupDelivery.isPending} className="gap-1">
                              {t("driverDashboard.pickup")}
                            </Button>
                          )}
                          {d.status === "recolhido" && (
                            <>
                              <Button size="sm" onClick={() => {
                                setSelectedDeliveryId(d.id);
                                setProofDialogOpen(true);
                              }} className="gap-1">
                                <Camera className="h-3.5 w-3.5" /> {t("driverDashboard.proof")}
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => {
                                setQrDeliveryId(d.id);
                                setQrOrderId(d.order_id);
                                setQrDialogOpen(true);
                              }} className="gap-1">
                                <QrCode className="h-3.5 w-3.5" /> QR
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>

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

      {/* QR Code Dialog */}
      <Dialog open={qrDialogOpen} onOpenChange={setQrDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("driverDashboard.qrTitle")}</DialogTitle>
            <DialogDescription>{t("driverDashboard.qrDesc")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            {qrOrderId && <QRCode value={qrOrderId} size={200} />}
            <p className="text-xs text-muted-foreground text-center">
              {t("driverDashboard.qrInstruction")}
            </p>
          </div>
          <DialogFooter>
            <Button onClick={handleQRValidate} disabled={validateQR.isPending}>
              {validateQR.isPending ? t("common.saving") : t("driverDashboard.qrValidate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DriverDashboard;
