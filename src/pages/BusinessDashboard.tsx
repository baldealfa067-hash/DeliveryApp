import { useRestaurantTeamAccess } from "@/hooks/useRestaurantTeamAccess";
import { RestaurantTeam } from "@/components/RestaurantTeam";
import { useEffect, useRef, useState } from "react";
import { BUCKET_PRIVADO, caminhoPrivado } from "@/lib/armazenamentoPrivado";
import { Link, useNavigate } from "react-router-dom";
import {
  Loader2,
  Settings,
  Eye,
  MessageCircle,
  Phone,
  MessageSquareText,
  Store,
  ShoppingCart,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  DollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProviderStatsQuery } from "@/hooks/useProviderStats";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { PanelHeader } from "@/components/PanelHeader";
import { useBusinessCategories } from "@/hooks/useProviders";
import { translateCategoryName } from "@/lib/categoryI18n";
import OrderManagement from "@/components/OrderManagement";
import { useBusinessSalesStats, useBusinessDailySales } from "@/hooks/useBusinessSales";
import { useBusinessCommission, useCommissionPayments, useCreateCommissionPayment, usePlatformSettings } from "@/hooks/useCommission";
import { formatCFA } from "@/lib/format";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { TrendingUp, Upload, Copy, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import BusinessCurrentAccount from "@/components/BusinessCurrentAccount";
import { ManualOrderDialog } from "@/components/ManualOrderDialog";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { BusinessCashSettlements } from "@/components/BusinessCashSettlements";

type DashboardProfile = {
  id: string;
  user_id: string;
  name: string;
  category: string;
  photo_url: string | null;
  verification_status: string;
  lat: number | null;
  lng: number | null;
};

const BusinessDashboard = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, isBusiness, isAdmin, rolesLoaded, loading, signOut } = useAuth();
  const qc = useQueryClient();
  const staff = useRestaurantTeamAccess(rolesLoaded ? user?.id : undefined);
  const [profile, setProfile] = useState<DashboardProfile | null>(null);
  const owner = !!profile && profile.user_id === user?.id;
  const staffPermissions = profile && staff.data?.business_id === profile.id ? staff.data.permissions : [];
  const ordersAccess = owner || staffPermissions.includes("orders");
  const financeAccess = owner || staffPermissions.includes("finance");
  const commissionAccess = owner || staffPermissions.includes("commission");
  const tabs = [
    ["pedidos", ShoppingCart, "businessDashboard.ordersManagement", ordersAccess],
    ["vendas", TrendingUp, "businessDashboard.salesTab", financeAccess],
    ["conta", DollarSign, "businessDashboard.accountTab", financeAccess],
    ["comissoes", DollarSign, "restaurantTeam.commission", commissionAccess],
    ["perfil", Store, "businessDashboard.profileTab", owner],
  ] as const;
  const allowedTabs = tabs.filter(([, , , allowed]) => allowed);
  const [selectedTab, setSelectedTab] = useState("pedidos");
  const [fetching, setFetching] = useState(true);
  const [resetOpen, setResetOpen] = useState(false);
  const [resettingOperation, setResettingOperation] = useState(false);
  const { data: profileCounts } = useQuery({
    queryKey: ["restaurant-profile-counts", profile?.id],
    enabled: owner,
    refetchInterval: 15000,
    queryFn: async () => {
      const id = profile!.id;
      const [orders, reviews] = await Promise.all([
        supabase.rpc("get_restaurant_operation_order_count", { p_business_id: id }),
        supabase.from("reviews").select("id", { count: "exact", head: true }).eq("provider_id", id),
      ]);
      if (orders.error) throw orders.error;
      if (reviews.error) throw reviews.error;
      return { orders: orders.data ?? 0, reviews: reviews.count ?? 0 };
    },
  });
  const { data: stats = { profile_views: 0, whatsapp_clicks: 0, call_clicks: 0 } } = useProviderStatsQuery(profile?.id ?? null);
  const { data: bizCats = [] } = useBusinessCategories();
  const { data: salesStats } = useBusinessSalesStats(financeAccess ? profile?.id ?? null : null);
  const { data: dailySales = [] } = useBusinessDailySales(financeAccess ? profile?.id ?? null : null);
  const { data: commission } = useBusinessCommission(commissionAccess ? profile?.id ?? null : null);
  const { data: commissionPayments = [] } = useCommissionPayments(commissionAccess ? profile?.id ?? null : null);
  const createCommissionPayment = useCreateCommissionPayment();
  const { data: platformSettings } = usePlatformSettings();
  const [commProofUrl, setCommProofUrl] = useState<string | null>(null);
  const [commProofUploading, setCommProofUploading] = useState(false);
  const [commProofPreview, setCommProofPreview] = useState<string | null>(null);
  const [commAmount, setCommAmount] = useState("");
  const commProofRef = useRef<HTMLInputElement>(null);
  const [commCopied, setCommCopied] = useState(false);

  const platformMerchantCode = platformSettings?.platform_merchant_code ?? "";
  const platformPaymentNumber = platformSettings?.platform_payment_number ?? "";

  const handleCommProofUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (file.size > 5 * 1024 * 1024) return toast.error(t("common.imageTooLarge"));
    setCommProofUploading(true);
    // Bucket PRIVADO: só o restaurante que o enviou e o admin o vêem. Guarda-se o
    // nome do objecto; a miniatura é local.
    const path = caminhoPrivado(user.id, file.name.split(".").pop() ?? "jpg");
    const { error } = await supabase.storage.from(BUCKET_PRIVADO.comprovativosComissao).upload(path, file, { contentType: file.type });
    if (error) { setCommProofUploading(false); return toast.error(error.message); }
    setCommProofUrl(path);
    setCommProofPreview((antiga) => {
      if (antiga) URL.revokeObjectURL(antiga);
      return URL.createObjectURL(file);
    });
    setCommProofUploading(false);
  };

  const submitCommissionPayment = async () => {
    if (!profile?.id || !commProofUrl) return;
    const amount = parseFloat(commAmount);
    if (isNaN(amount) || amount <= 0) return toast.error(t("commission.enterAmount"));
    try {
      await createCommissionPayment.mutateAsync({ businessId: profile.id, amount, proofUrl: commProofUrl });
      toast.success(t("commission.paymentSent"));
      setCommAmount("");
      setCommProofUrl(null);
      if (commProofRef.current) commProofRef.current.value = "";
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const resetOperation = async () => {
    if (!owner || !profile || resettingOperation) return;
    const id = profile.id;
    setResettingOperation(true);
    try {
      const { error } = await supabase.rpc("reset_restaurant_operation", { p_business_id: id });
      if (error) {
        toast.error(error.code === "PT409" ? t("restaurantSetup.resetActive") : t("restaurantSetup.resetError"));
        return;
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["restaurant-profile-counts", id] }),
        qc.invalidateQueries({ queryKey: ["business-orders", id] }),
        qc.invalidateQueries({ queryKey: ["business-sales-stats", id] }),
        qc.invalidateQueries({ queryKey: ["business-daily-sales", id] }),
      ]);
      setResetOpen(false);
      toast.success(t("restaurantSetup.resetDone"));
    } finally {
      setResettingOperation(false);
    }
  };

  useEffect(() => {
    if (loading || !rolesLoaded) return;
    if (!user) return navigate("/login?mode=equipa", { replace: true });
    if (!isBusiness && !isAdmin && staff.isPending) return;
    let active = true;
    setFetching(true);
    (async () => {
      const columns = "id, user_id, name, category, photo_url, verification_status, lat, lng";
      const query = supabase.from("profiles").select(columns).eq("profile_type", "business");
      const own = await query.eq("user_id", user.id).maybeSingle();
      const { data } = own.data || !staff.data ? own : await supabase.from("profiles")
        .select(columns).eq("profile_type", "business").eq("id", staff.data.business_id).maybeSingle();
      if (!active) return;
      setProfile(data as DashboardProfile | null);
      setFetching(false);
    })();
    return () => { active = false; };
  }, [user, isBusiness, isAdmin, rolesLoaded, loading, navigate, staff.isPending, staff.data?.business_id]);

  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel(`business-stats-${profile.id}-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "provider_stats", filter: `provider_id=eq.${profile.id}` },
        () => { qc.invalidateQueries({ queryKey: ["provider-stats", profile.id] }); }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders", filter: `business_id=eq.${profile.id}` },
        () => { void qc.invalidateQueries({ queryKey: ["restaurant-profile-counts", profile.id] }); }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reviews", filter: `provider_id=eq.${profile.id}` },
        () => { void qc.invalidateQueries({ queryKey: ["restaurant-profile-counts", profile.id] }); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.id, qc]);

  if (loading || !rolesLoaded || fetching) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">{t("businessDashboard.loading")}</div>;
  }

  const initials = (profile?.name ?? "?").slice(0, 2).toUpperCase();

  const verificationBadge = (() => {
    switch (profile?.verification_status) {
      case "aprovado":
        return (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1">
            <ShieldCheck className="h-3 w-3 text-success" /> {t("businessDashboard.verified")}
          </Badge>
        );
      case "pendente":
        return (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1">
            <ShieldAlert className="h-3 w-3 text-yellow-600" /> {t("businessDashboard.pendingVerification")}
          </Badge>
        );
      case "rejeitado":
        return (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1">
            <ShieldX className="h-3 w-3 text-destructive" /> {t("businessDashboard.rejectedVerification")}
          </Badge>
        );
      default:
        return null;
    }
  })();

  return (
    <div className="min-h-screen bg-background">
      <PanelHeader
        onLogout={() => signOut().then(() => navigate("/"))}
        extra={isAdmin && (
          <Link to="/admin"><Button variant="outline" size="sm" className="min-h-11 px-2 sm:px-3">{t("common.admin")}</Button></Link>
        )}
      />

      <main className="max-w-2xl mx-auto px-4 py-6 pb-[calc(env(safe-area-inset-bottom))]">
        {!profile || !allowedTabs.length ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <Store className="h-8 w-8 text-muted-foreground" />
              <p className="text-muted-foreground">{t(isBusiness || isAdmin ? "businessDashboard.noProfile" : "restaurantTeam.noAccess")}</p>
              {(isBusiness || isAdmin) && <Button onClick={() => navigate("/painel-loja/editar")} className="gap-2 min-h-12 text-base">
                <Settings className="h-5 w-5" /> {t("businessDashboard.createProfile")}
              </Button>}
            </CardContent>
          </Card>
        ) : (
          <Tabs value={allowedTabs.some(([value]) => value === selectedTab) ? selectedTab : allowedTabs[0]?.[0]} onValueChange={setSelectedTab}>
            {!owner && <h1 className="mb-4 text-xl font-semibold">{profile.name}</h1>}
            <TabsList className="mb-4 flex h-auto w-full flex-wrap gap-1 p-1">
              {allowedTabs.map(([valor, Icone, chave]) => (
                <TabsTrigger
                  key={valor}
                  value={valor}
                  className="flex min-h-14 min-w-0 flex-1 flex-col items-center gap-1 whitespace-normal px-1 py-2 text-xs sm:text-sm"
                >
                  <Icone className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="w-full break-words text-center leading-tight">{t(chave)}</span>
                </TabsTrigger>
              ))}
            </TabsList>

            {ordersAccess && <TabsContent value="pedidos" className="mt-0 space-y-3">
              {/* Fase 2.4 — pedidos por telefone e balcão entram na mesma lista
                  e na mesma tabela; o que muda é `source`. */}
              <ManualOrderDialog
                businessId={profile.id}
                onConfigurePickup={owner ? () => navigate("/painel-loja/editar#ponto-de-recolha") : undefined}
                pickupConfigured={profile.lat != null && profile.lng != null
                  && Math.abs(profile.lat) <= 90 && Math.abs(profile.lng) <= 180}
              />
              <OrderManagement businessId={profile.id} />
            </TabsContent>}

            {financeAccess && <TabsContent value="vendas" className="mt-0 space-y-4">
              {salesStats && (
                <>
                  {/* Today */}
                  <Card className="border-primary/20 bg-primary/5">
                    <CardContent className="p-4">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t("businessDashboard.salesToday")}</p>
                      <div className="flex items-baseline gap-3">
                        <span className="text-3xl font-bold text-primary">{formatCFA(salesStats.today_total)}</span>
                        <span className="text-sm text-muted-foreground">{salesStats.today_count} {t("businessDashboard.orders")}</span>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Semana + mês + ticket médio. No telemóvel, uma coluna com o
                      rótulo à esquerda e o valor à direita: em 3 colunas a 360px
                      cada cartão tem ~80px, e "28 000 CFA" (inseparável) não cabe.
                      A partir de 640px voltam as 3 colunas. */}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
                    <CartaoVenda
                      rotulo={t("businessDashboard.last7days")}
                      valor={formatCFA(salesStats.week_total)}
                      detalhe={`${salesStats.week_count} ${t("businessDashboard.orders")}`}
                    />
                    <CartaoVenda
                      rotulo={t("businessDashboard.thisMonth")}
                      valor={formatCFA(salesStats.month_total)}
                      detalhe={`${salesStats.month_count} ${t("businessDashboard.orders")}`}
                    />
                    <CartaoVenda
                      rotulo={t("businessDashboard.avgTicket")}
                      valor={formatCFA(salesStats.avg_ticket)}
                      detalhe={t("businessDashboard.perOrder")}
                    />
                  </div>

                  {/* Chart */}
                  {dailySales.length > 0 && (
                    <Card>
                      <CardContent className="p-4">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t("businessDashboard.salesChart")}</p>
                        <ResponsiveContainer width="100%" height={200}>
                          <BarChart data={dailySales}>
                            <XAxis
                              dataKey="day"
                              tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { weekday: "short" })}
                              tick={{ fontSize: 11 }}
                            />
                            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                            <Tooltip
                              formatter={(v: number) => [formatCFA(v), t("businessDashboard.salesTab")]}
                              labelFormatter={(v) => new Date(v).toLocaleDateString()}
                            />
                            <Bar dataKey="total" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  )}
                </>
              )}

            </TabsContent>}

            {commissionAccess && <TabsContent value="comissoes" className="mt-0 space-y-4">
              {commission && (
                <Card className="border-orange-200 dark:border-orange-800">
                  <CardContent className="p-4 space-y-3">
                    <p className="text-xs font-semibold text-orange-700 dark:text-orange-300 uppercase tracking-wide">
                      {t("commission.title")}
                    </p>
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div>
                        <span className="text-[10px] text-muted-foreground uppercase block">{t("commission.due")}</span>
                        <span className="text-base font-bold sm:text-lg">{formatCFA(commission.commission_due)}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-muted-foreground uppercase block">{t("commission.paid")}</span>
                        <span className="text-base font-bold text-success sm:text-lg">{formatCFA(commission.commission_paid)}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-muted-foreground uppercase block">{t("commission.balance")}</span>
                        <span className={"text-base font-bold sm:text-lg " + (commission.commission_balance > 0 ? "text-pending" : "text-success")}>
                          {formatCFA(commission.commission_balance)}
                        </span>
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {t("commission.rateInfo", { rate: commission.commission_rate, sales: formatCFA(commission.total_sales) })}
                    </p>

                    {/* Pay commission */}
                    {commission.commission_balance > 0 && (platformMerchantCode || platformPaymentNumber) && (
                      <div className="rounded-lg border p-3 space-y-2">
                        <p className="text-xs font-semibold">{t("commission.payCommission")}</p>

                        {platformMerchantCode && (
                          <div className="space-y-1">
                            <a
                              href={`tel:${platformMerchantCode.replace(/#/g, "%23")}`}
                              className="flex items-center justify-center gap-2 w-full rounded-lg bg-orange-600 hover:bg-orange-700 text-white font-bold py-2.5 px-4 transition-colors"
                            >
                              <Phone className="h-4 w-4" />
                              {platformMerchantCode}
                            </a>
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] text-muted-foreground">{t("businessDetail.tapToPayUssd")}</span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="gap-1 text-xs h-5"
                                onClick={() => {
                                  navigator.clipboard.writeText(platformMerchantCode);
                                  setCommCopied(true);
                                  setTimeout(() => setCommCopied(false), 2000);
                                }}
                              >
                                {commCopied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                                {t("businessDetail.copyCode")}
                              </Button>
                            </div>
                          </div>
                        )}

                        {!platformMerchantCode && platformPaymentNumber && (
                          <div className="flex items-center justify-between">
                            <span className="font-bold">{platformPaymentNumber}</span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="gap-1 text-xs"
                              onClick={() => {
                                navigator.clipboard.writeText(platformPaymentNumber);
                                toast.success(t("businessDetail.numberCopied"));
                              }}
                            >
                              <Copy className="h-3 w-3" /> {t("businessDetail.copyNumber")}
                            </Button>
                          </div>
                        )}

                        <div className="space-y-1.5">
                          <Label className="text-xs">{t("commission.amount")}</Label>
                          <Input
                            type="number"
                            min="1"
                            placeholder={String(commission.commission_balance)}
                            value={commAmount}
                            onChange={(e) => setCommAmount(e.target.value)}
                          />
                        </div>

                        <input ref={commProofRef} type="file" accept="image/*" className="hidden" onChange={handleCommProofUpload} />
                        {commProofUrl ? (
                          <div className="flex items-center gap-2">
                            {commProofPreview && <img src={commProofPreview} alt="" className="h-12 w-12 rounded-md border object-cover" />}
                            <Check className="h-4 w-4 text-success" />
                            <span className="text-sm text-success-foreground font-medium">{t("businessDetail.proofAttached")}</span>
                            <Button variant="ghost" size="sm" className="text-xs ml-auto" onClick={() => {
                              // Ainda solto: o servidor deixa apagar, e não fica lixo privado.
                              if (commProofUrl) void supabase.storage.from(BUCKET_PRIVADO.comprovativosComissao).remove([commProofUrl]);
                              setCommProofUrl(null);
                              setCommProofPreview(null);
                              if (commProofRef.current) commProofRef.current.value = "";
                            }}>
                              {t("businessDetail.changeProof")}
                            </Button>
                          </div>
                        ) : (
                          <Button variant="outline" className="w-full gap-2" onClick={() => commProofRef.current?.click()} disabled={commProofUploading}>
                            {commProofUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                            {t("businessDetail.attachProof")}
                          </Button>
                        )}

                        <Button
                          className="w-full"
                          disabled={!commProofUrl || !commAmount || createCommissionPayment.isPending}
                          onClick={submitCommissionPayment}
                        >
                          {createCommissionPayment.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          {t("commission.submit")}
                        </Button>
                      </div>
                    )}

                    {/* Recent commission payments */}
                    {commissionPayments.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-xs font-semibold text-muted-foreground">{t("commission.history")}</p>
                        {commissionPayments.slice(0, 5).map((cp) => (
                          <div key={cp.id} className="flex items-center justify-between text-xs border rounded-md p-2">
                            <span>{new Date(cp.created_at).toLocaleDateString()}</span>
                            <span className="font-medium">{formatCFA(cp.amount)}</span>
                            <Badge
                              variant="secondary"
                              className={
                                cp.status === "validado" ? "bg-success-soft text-success-foreground" :
                                cp.status === "rejeitado" ? "bg-problem-soft text-problem-foreground" :
                                "bg-yellow-100 text-yellow-700"
                              }
                            >
                              {t(`commission.status_${cp.status}`, cp.status)}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </TabsContent>}

            {financeAccess && <TabsContent value="conta" className="mt-0 space-y-4">
              {owner && <BusinessCurrentAccount businessId={profile.id} />}
              {/* Fase 2.3 — o dinheiro que os motoristas cobraram aos clientes e
                  ainda não entregaram (§28). Fica na conta corrente e não numa
                  aba nova: é a mesma pergunta que o dono já vem aqui fazer
                  ("quanto tenho a haver, e a quem?"), só muda a contraparte —
                  ali é a plataforma, aqui é a frota. */}
              <BusinessCashSettlements businessId={profile.id} />
            </TabsContent>}

            {owner && <TabsContent value="perfil" className="mt-0 space-y-4">
              {/* Profile header */}
              <div className="flex items-center gap-4">
                <Avatar className="h-16 w-16 rounded-xl">
                  {profile.photo_url ? <AvatarImage src={profile.photo_url} className="object-cover" /> : null}
                  <AvatarFallback className="rounded-xl bg-primary/10 text-primary text-lg font-bold">{initials}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <h1 className="text-xl font-bold truncate">{profile.name}</h1>
                  <p className="text-sm text-muted-foreground flex items-center gap-1.5 flex-wrap">
                    {translateCategoryName(profile.category, bizCats as { id: string; name: string; name_en: string | null; name_fr: string | null }[], i18n.language)}
                    {verificationBadge}
                  </p>
                </div>
              </div>

              {/* Configure button */}
              <Button onClick={() => navigate("/painel-loja/editar")} className="w-full gap-2 min-h-12 text-base">
                <Settings className="h-5 w-5" /> {t("businessDashboard.configure")}
              </Button>

              {/* Stats */}
              <Card>
                <CardContent className="p-4">
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    <div className="rounded-lg border p-3 flex flex-col items-center gap-1">
                      <ShoppingCart className="h-5 w-5 text-primary" />
                      <span className="text-2xl font-bold">{profileCounts?.orders ?? "—"}</span>
                      <span className="text-[11px] text-muted-foreground text-center">{t("businessDashboard.ordersReceived")}</span>
                    </div>
                    <div className="rounded-lg border p-3 flex flex-col items-center gap-1">
                      <Eye className="h-5 w-5 text-primary" />
                      <span className="text-2xl font-bold">{stats.profile_views}</span>
                      <span className="text-[11px] text-muted-foreground text-center">{t("businessDashboard.profileViews")}</span>
                    </div>
                    <div className="rounded-lg border p-3 flex flex-col items-center gap-1">
                      <MessageCircle className="h-5 w-5 text-[#25D366]" />
                      <span className="text-2xl font-bold">{stats.whatsapp_clicks}</span>
                      <span className="text-[11px] text-muted-foreground text-center">{t("businessDashboard.whatsappContacts")}</span>
                    </div>
                    <div className="rounded-lg border p-3 flex flex-col items-center gap-1">
                      <Phone className="h-5 w-5 text-secondary-foreground" />
                      <span className="text-2xl font-bold">{stats.call_clicks}</span>
                      <span className="text-[11px] text-muted-foreground text-center">{t("businessDashboard.calls")}</span>
                    </div>
                    <div className="rounded-lg border p-3 flex flex-col items-center gap-1">
                      <MessageSquareText className="h-5 w-5 text-muted-foreground" />
                      <span className="text-2xl font-bold">{profileCounts?.reviews ?? "—"}</span>
                      <span className="text-[11px] text-muted-foreground text-center">{t("businessDashboard.comments")}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <RestaurantTeam businessId={profile.id} />

              <Card>
                <CardContent className="space-y-3 p-4">
                  <h2 className="font-semibold">{t("restaurantSetup.resetTitle")}</h2>
                  <p className="text-sm text-muted-foreground">{t("restaurantSetup.resetDescription")}</p>
                  <Button variant="outline" className="text-destructive" onClick={() => setResetOpen(true)}>
                    {t("restaurantSetup.resetButton")}
                  </Button>
                </CardContent>
              </Card>
              <ConfirmDialog open={resetOpen} onOpenChange={setResetOpen}
                title={t("restaurantSetup.resetTitle")} description={t("restaurantSetup.resetConfirm")}
                confirmLabel={t("restaurantSetup.resetButton")} busy={resettingOperation} destructive
                onConfirm={() => void resetOperation()} />

              {/* View public page */}
              <Link to={`/loja/${profile.id}`} className="block">
                <Button variant="outline" className="w-full min-h-12 text-base">
                  {t("businessDashboard.viewPublic")}
                </Button>
              </Link>
            </TabsContent>}
          </Tabs>
        )}
      </main>
    </div>
  );
};

export default BusinessDashboard;

/** Um total da aba Vendas: em linha no telemóvel, em coluna a partir de 640px.
 *  `sm:contents` desfaz o bloco da esquerda para o `order` arrumar rótulo,
 *  valor e detalhe um por baixo do outro. */
const CartaoVenda = ({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe: string }) => (
  <Card>
    <CardContent className="flex items-center justify-between gap-3 p-3 sm:flex-col sm:justify-center sm:gap-1 sm:text-center">
      <div className="min-w-0 sm:contents">
        <span className="block text-[10px] uppercase text-muted-foreground sm:order-1">{rotulo}</span>
        <span className="block text-[10px] text-muted-foreground sm:order-3">{detalhe}</span>
      </div>
      <span className="shrink-0 whitespace-nowrap text-lg font-bold sm:order-2">{valor}</span>
    </CardContent>
  </Card>
);
