import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  LogOut,
  ArrowLeft,
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProviderStatsQuery } from "@/hooks/useProviderStats";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useBusinessCategories } from "@/hooks/useProviders";
import { translateCategoryName } from "@/lib/categoryI18n";
import OrderManagement from "@/components/OrderManagement";

type DashboardProfile = {
  id: string;
  name: string;
  category: string;
  photo_url: string | null;
  verification_status: string;
};

const BusinessDashboard = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, isBusiness, isAdmin, rolesLoaded, loading, signOut } = useAuth();
  const qc = useQueryClient();
  const [profile, setProfile] = useState<DashboardProfile | null>(null);
  const [fetching, setFetching] = useState(true);
  const [orderCount, setOrderCount] = useState(0);
  const [commentCount, setCommentCount] = useState(0);
  const { data: stats = { profile_views: 0, whatsapp_clicks: 0, call_clicks: 0 } } = useProviderStatsQuery(profile?.id ?? null);
  const { data: bizCats = [] } = useBusinessCategories();

  const loadCounts = async (pid: string) => {
    const [{ count: orders }, { count: reviews }] = await Promise.all([
      supabase.from("orders").select("id", { count: "exact", head: true }).eq("business_id", pid),
      supabase.from("reviews").select("id", { count: "exact", head: true }).eq("provider_id", pid),
    ]);
    setOrderCount(orders ?? 0);
    setCommentCount(reviews ?? 0);
  };

  useEffect(() => {
    if (loading || !rolesLoaded) return;
    if (!user) return navigate("/login", { replace: true });
    if (!isBusiness && !isAdmin) return navigate("/inicio", { replace: true });
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, name, category, photo_url, verification_status")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data) {
        setProfile(data as DashboardProfile);
        await loadCounts(data.id);
      }
      setFetching(false);
    })();
  }, [user, isBusiness, isAdmin, rolesLoaded, loading, navigate]);

  useEffect(() => {
    if (!profile?.id) return;
    const interval = setInterval(() => loadCounts(profile.id), 15000);
    return () => clearInterval(interval);
  }, [profile?.id]);

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
        () => loadCounts(profile.id)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reviews", filter: `provider_id=eq.${profile.id}` },
        () => loadCounts(profile.id)
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.id, qc]);

  if (loading || fetching) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">{t("businessDashboard.loading")}</div>;
  }

  const initials = (profile?.name ?? "?").slice(0, 2).toUpperCase();

  const verificationBadge = (() => {
    switch (profile?.verification_status) {
      case "aprovado":
        return (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1">
            <ShieldCheck className="h-3 w-3 text-green-600" /> {t("businessDashboard.verified")}
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
      <header className="border-b">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground p-2 -m-2 rounded-md">
            <ArrowLeft className="h-4 w-4" /> {t("common.home")}
          </Link>
          <div className="flex items-center gap-2">
            <LanguageSelector />
            {isAdmin && (
              <Link to="/admin"><Button variant="outline" size="sm">{t("common.admin")}</Button></Link>
            )}
            <Button variant="ghost" size="sm" onClick={() => signOut().then(() => navigate("/"))} className="gap-1 min-h-11">
              <LogOut className="h-4 w-4" /> {t("common.logout")}
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 pb-[calc(env(safe-area-inset-bottom))]">
        {!profile ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <Store className="h-8 w-8 text-muted-foreground" />
              <p className="text-muted-foreground">{t("businessDashboard.noProfile")}</p>
              <Button onClick={() => navigate("/painel-loja/editar")} className="gap-2 min-h-12 text-base">
                <Settings className="h-5 w-5" /> {t("businessDashboard.createProfile")}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Tabs defaultValue="pedidos">
            <TabsList className="w-full h-12 mb-4">
              <TabsTrigger value="pedidos" className="flex-1 text-sm min-h-10 gap-1.5">
                <ShoppingCart className="h-4 w-4" />
                {t("businessDashboard.ordersManagement")}
              </TabsTrigger>
              <TabsTrigger value="perfil" className="flex-1 text-sm min-h-10 gap-1.5">
                <Store className="h-4 w-4" />
                {t("businessDashboard.profileTab")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="pedidos" className="mt-0">
              <OrderManagement businessId={profile.id} />
            </TabsContent>

            <TabsContent value="perfil" className="mt-0 space-y-4">
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
                      <span className="text-2xl font-bold">{orderCount}</span>
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
                      <span className="text-2xl font-bold">{commentCount}</span>
                      <span className="text-[11px] text-muted-foreground text-center">{t("businessDashboard.comments")}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* View public page */}
              <Link to={`/loja/${profile.id}`} className="block">
                <Button variant="outline" className="w-full min-h-12 text-base">
                  {t("businessDashboard.viewPublic")}
                </Button>
              </Link>
            </TabsContent>
          </Tabs>
        )}
      </main>
    </div>
  );
};

export default BusinessDashboard;
