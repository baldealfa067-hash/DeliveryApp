import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, Settings, Briefcase, Loader2, Eye, MessageCircle, Phone, MessageSquareText, Star, BellRing, Scissors, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { usePushSettings } from "@/hooks/usePushSettings";
import { supabase } from "@/integrations/supabase/client";
import { useProviderStatsQuery, useCommentCount, useCommentCountRealtime, useQualityLevel, useQualityLevelRealtime } from "@/hooks/useProviderStats";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

type ProviderProfile = {
  id: string;
  name: string;
  category: string;
  profile_type: string;
  phone: string;
  location: string;
  description: string | null;
  photo_url: string | null;
  price_type: string;
  starting_price: number | null;
};

const Profile = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, isProvider, isBusiness, isBeleza, isClient, isAdmin, roles, loading, signOut } = useAuth();
  const qc = useQueryClient();
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const { data: commentCount = 0 } = useCommentCount(profileId);
  const { data: qualityLevel } = useQualityLevel(profileId);
  useCommentCountRealtime(profileId);
  useQualityLevelRealtime(profileId);

  const { data: stats } = useProviderStatsQuery(profileId);
  const push = usePushSettings(user?.id ?? null);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate("/login", { replace: true });
      return;
    }
    if (isAdmin) {
      navigate("/admin", { replace: true });
      return;
    }
    if (isBusiness && !isProvider) {
      navigate("/painel-loja", { replace: true });
      return;
    }
    supabase
      .from("profiles")
      .select("id, name, category, profile_type, phone, location, description, photo_url, price_type, starting_price")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setProfile(data as ProviderProfile);
          setProfileId((data as { id?: string }).id ?? null);
        }
      });
  }, [user, isAdmin, loading, navigate]);

  useEffect(() => {
    if (!profileId) return;
    const channel = supabase
      .channel(`profile-stats-${profileId}-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "provider_stats", filter: `provider_id=eq.${profileId}` },
        () => { qc.invalidateQueries({ queryKey: ["provider-stats", profileId] }); }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        () => { qc.invalidateQueries({ queryKey: ["notifications"] }); qc.invalidateQueries({ queryKey: ["notifications-unread"] }); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profileId, qc]);

  const handleLogout = async () => {
    await signOut();
    toast.success(t("profile.sessionClosed"));
    navigate("/", { replace: true });
  };

  if (loading) {
    return (
      <div className="max-w-lg mx-auto px-4 py-8 flex justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user || isAdmin) return null;

  const hasBelezaBusiness = isBeleza || profile?.profile_type === "beleza";

  if (!profile || !profile.name) {
    if (hasBelezaBusiness) {
      return (
        <div className="max-w-lg mx-auto px-4 py-8">
          <h1 className="text-2xl font-bold mb-4">{t("profile.myProfile")}</h1>
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
              <Scissors className="h-8 w-8 text-muted-foreground" />
              <p className="text-muted-foreground">{t("beautyDashboard.noProfile")}</p>
              <Button onClick={() => navigate("/painel-beleza/editar")}>{t("beautyDashboard.createProfile")}</Button>
            </CardContent>
          </Card>
        </div>
      );
    }
    if (isClient) {
      const clientEmail = user?.email ?? "";
      const clientInitials = (user?.name?.split(' ')[0] ?? clientEmail.split('@')[0] ?? 'U').slice(0, 2).toUpperCase();
      return (
        <div className="max-w-lg mx-auto px-4 py-8">
          <h1 className="text-2xl font-bold mb-4">{t("profile.myProfile")}</h1>
          <Card>
            <CardHeader className="flex flex-row items-center gap-4">
              <Avatar className="h-16 w-16">
                <AvatarFallback className="text-lg">{clientInitials}</AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-lg">{user?.name ?? clientEmail.split('@')[0]}</CardTitle>
                <p className="text-sm text-muted-foreground">{t("profile.client")}</p>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 mt-4">
              {clientEmail && (
                <div className="rounded-lg border p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("profile.email")}</span>
                    <span className="font-medium">{clientEmail}</span>
                  </div>
                </div>
              )}
              <Button variant="outline" onClick={() => navigate("/pedidos")} className="w-full justify-start gap-2">
                <ClipboardList className="h-4 w-4" />
                {t("profile.myRequests")}
              </Button>
              <Button variant="outline" onClick={() => navigate("/login?mode=profissional")} className="w-full justify-start gap-2">
                <Briefcase className="h-4 w-4" />
                {t("profile.becomeProvider")}
              </Button>
              <Button variant="destructive" onClick={handleLogout} className="w-full justify-start gap-2">
                <LogOut className="h-4 w-4" />
                {t("profile.logout")}
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }
    return (
      <div className="max-w-lg mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-4">{t("profile.myProfile")}</h1>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-muted-foreground">{t("profile.noProviderProfile")}</p>
            <Button onClick={() => navigate("/painel")}>{t("profile.createProviderProfile")}</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const email = user?.email ?? user?.name?.split(' ')[0] ?? "";
  const initials = (profile?.name ?? (user?.email ?? user?.name ?? 'Utilizador').split(' ')[0] ?? 'U').slice(0, 2).toUpperCase();

  return (
    <div className="max-w-lg mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">{t("profile.myProfile")}</h1>

      <Card>
        <CardHeader className="flex flex-row items-center gap-4">
          <Avatar className="h-16 w-16">
            {profile?.photo_url ? (
              <AvatarImage src={profile.photo_url} alt={profile.name} />
            ) : null}
            <AvatarFallback className="text-lg">{initials}</AvatarFallback>
          </Avatar>
          <div>
            <CardTitle className="text-lg">
              {profile?.name ?? email}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {profile ? profile.category : roles.length > 0 ? roles.join(", ") : t("profile.client")}
            </p>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 mt-4">
          {(isProvider || hasBelezaBusiness) && profile && (
            <div className="rounded-lg border p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("profile.phone")}</span>
                <span className="font-medium">{profile.phone}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("profile.location")}</span>
                <span className="font-medium">{profile.location}</span>
              </div>
              {profile.price_type === "fixo" && profile.starting_price != null && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("profile.price")}</span>
                  <span className="font-medium">{profile.starting_price} FCFA</span>
                </div>
              )}
              {profile.price_type === "negociavel" && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("profile.price")}</span>
                  <span className="font-medium">{t("common.negotiable")}</span>
                </div>
              )}
              {profile.price_type === "combinar" && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("profile.price")}</span>
                  <span className="font-medium">{t("common.toCombine")}</span>
                </div>
              )}
              {profile.description && (
                <div>
                  <span className="text-muted-foreground">{t("profile.description")}</span>
                  <p className="mt-1">{profile.description}</p>
                </div>
              )}
            </div>
          )}
          {(isProvider || hasBelezaBusiness) && (
            <div className="rounded-lg border p-4">
              <p className="text-sm font-semibold mb-3">{t("profile.statsTitle")}</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <Eye className="h-4 w-4 text-primary" />
                  <span><span className="font-bold">{stats?.profile_views ?? 0}</span> <span className="text-muted-foreground">{t("profile.views")}</span></span>
                </div>
                <div className="flex items-center gap-2">
                  <MessageCircle className="h-4 w-4 text-[#25D366]" />
                  <span><span className="font-bold">{stats?.whatsapp_clicks ?? 0}</span> <span className="text-muted-foreground">{t("profile.whatsapp")}</span></span>
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-secondary-foreground" />
                  <span><span className="font-bold">{stats?.call_clicks ?? 0}</span> <span className="text-muted-foreground">{t("profile.calls")}</span></span>
                </div>
                <div className="flex items-center gap-2">
                  <MessageSquareText className="h-4 w-4 text-muted-foreground" />
                  <span><span className="font-bold">{commentCount}</span> <span className="text-muted-foreground">{t("profile.comments")}</span></span>
                </div>
                <div className="flex items-center gap-2">
                  <Star className="h-4 w-4 text-yellow-500" />
                  <span><span className="font-bold">{qualityLevel ?? t("profile.qualityDefault")}</span> <span className="text-muted-foreground">{t("profile.quality")}</span></span>
                </div>
              </div>
            </div>
          )}
          {isProvider && (
            <Button variant="outline" onClick={() => navigate("/painel")} className="w-full justify-start gap-2">
              <Settings className="h-4 w-4" />
              {t("profile.editProvider")}
            </Button>
          )}
          {!isProvider && hasBelezaBusiness && (
            <Button variant="outline" onClick={() => navigate("/painel-beleza/editar")} className="w-full justify-start gap-2">
              <Scissors className="h-4 w-4" />
              {t("beautyDashboard.configure")}
            </Button>
          )}
          {!isProvider && !isBusiness && !hasBelezaBusiness && (
            <Button variant="outline" onClick={() => navigate("/painel")} className="w-full justify-start gap-2">
              <Briefcase className="h-4 w-4" />
              {t("profile.becomeProvider")}
            </Button>
          )}
          <Button variant="destructive" onClick={handleLogout} className="w-full justify-start gap-2">
            <LogOut className="h-4 w-4" />
            {t("profile.logout")}
          </Button>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <BellRing className="h-4 w-4 text-primary" />
            {t("profile.notifications")}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!push.supported ? (
            <p className="text-sm text-muted-foreground">
              {t("profile.pushNotSupported")}
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{t("profile.pushTitle")}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("profile.pushDesc")}
                  </p>
                </div>
                <Switch
                  checked={push.pushEnabled}
                  disabled={push.updating || (push.pushEnabled && push.permission !== "granted")}
                  onCheckedChange={push.togglePush}
                />
              </div>
              {push.permission === "denied" && (
                <p className="text-xs text-destructive">
                  {t("profile.pushDenied")}
                </p>
              )}
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{t("profile.newsTitle")}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("profile.newsDesc")}
                  </p>
                </div>
                <Switch
                  checked={push.novidades}
                  disabled={!push.pushEnabled || push.updating}
                  onCheckedChange={push.setNovidades}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Profile;
