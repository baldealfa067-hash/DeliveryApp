import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  LogOut,
  Trash2,
  BadgeCheck,
  Check,
  X,
  LayoutDashboard,
  Users,
  ShieldCheck,
  ShieldAlert,
  Star,
  ClipboardList,
  Tag,
  MapPin,
  BarChart3,
  Settings,
  Eye,
  MessageCircle,
  Phone,
  Images,
  ChevronRight,
  Store,
  Scissors,
  Send,
  Bell,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { formatCFA } from "@/lib/format";
import ManageList from "@/components/ManageList";
import ManageCategoryList from "@/components/ManageCategoryList";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import logo from "@/assets/logo.png";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { LanguageSelector } from "@/components/LanguageSelector";

type Provider = {
  id: string;
  name: string;
  category: string;
  phone: string;
  location: string;
  price_type: string;
  starting_price: number | null;
  photo_url: string | null;
  profile_type: string;
  is_verified: boolean;
  verification_status: string;
  verification_reason: string | null;
  verification_doc_url: string | null;
  verification_selfie_url: string | null;
  stats?: { profile_views: number; whatsapp_clicks: number; call_clicks: number };
};
type Request = { id: string; requester_name: string | null; category: string; location: string; description: string; status: string; created_at: string };
type Review = { id: string; provider_id: string; reviewer_name: string | null; rating: number; comment: string | null; created_at: string; status: string };
type Complaint = { id: string; provider_id: string; client_id: string | null; reason: string; description: string | null; contact: string | null; status: string; created_at: string };
type Category = { id: string; name: string; name_en?: string | null; name_fr?: string | null };
type Bairro = { id: string; name: string };
type ActivityType = "vista" | "whatsapp" | "call";
type ActivitySeries = Record<ActivityType, number[]>;
type AdminNotification = { id: string; title: string; body: string; target_groups: string[]; sent_by: string; recipients_count: number; created_at: string };

type MenuKey =
  | "overview"
  | "providers"
  | "verifications"
  | "complaints"
  | "reviews"
  | "requests"
  | "categories"
  | "lojas-categorias"
  | "beleza-categorias"
  | "bairros"
  | "stats"
  | "send_notification"
  | "settings";

type ProviderFilter = "todos" | "avaliacao" | "ativos" | "rejeitados";
type ReviewFilter = "pendentes" | "aprovadas";

const STATUS_BADGE_KEYS: Record<string, { key: string; className: string }> = {
  aprovado: { key: "admin.active", className: "bg-green-100 text-green-700" },
  pendente: { key: "admin.inReview", className: "bg-yellow-100 text-yellow-700" },
  rejeitado: { key: "admin.rejected", className: "bg-red-100 text-red-700" },
  none: { key: "admin.noVerification", className: "bg-muted text-muted-foreground" },
};

const buildActivityMap = (rows: { provider_id: string; activity_type: string; created_at: string }[]) => {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().slice(0, 10);
  });
  const map: Record<string, ActivitySeries> = {};
  rows.forEach((r) => {
    const t = r.activity_type as ActivityType;
    if (t !== "vista" && t !== "whatsapp" && t !== "call") return;
    const day = new Date(r.created_at).toISOString().slice(0, 10);
    const idx = days.indexOf(day);
    if (idx === -1) return;
    const entry = (map[r.provider_id] ??= { vista: [], whatsapp: [], call: [] });
    entry[t][idx] = (entry[t][idx] ?? 0) + 1;
  });
  Object.values(map).forEach((m) => {
    (Object.keys(m) as ActivityType[]).forEach((k) => {
      m[k] = Array.from({ length: 7 }, (_, i) => m[k][i] ?? 0);
    });
  });
  return map;
};

const MiniBars = ({ data, color = "bg-green-600" }: { data: number[]; color?: string }) => {
  const max = Math.max(...data, 1);
  return (
    <div className="flex items-end gap-1 h-9">
      {data.map((v, i) => (
        <div
          key={i}
          className={`${color} rounded-sm min-w-0`}
          style={{ height: `${Math.max((v / max) * 100, 6)}%`, width: "100%" }}
          title={`${v}`}
        />
      ))}
    </div>
  );
};

const StatCard = ({ label, value, icon, onClick }: { label: string; value: number; icon: React.ReactNode; onClick: () => void }) => (
  <button
    onClick={onClick}
    className="bg-card border rounded-xl p-4 flex items-center gap-3 text-left hover:border-primary/40 transition-colors"
  >
    <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
      {icon}
    </div>
    <div className="min-w-0">
      <div className="text-2xl font-bold leading-none">{value}</div>
      <div className="text-xs text-muted-foreground mt-1 truncate">{label}</div>
    </div>
  </button>
);

const AdminDashboard = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, isAdmin, loading, signOut } = useAuth();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [bairros, setBairros] = useState<Bairro[]>([]);
  const [businessCategories, setBusinessCategories] = useState<Category[]>([]);
  const [beautyCategories, setBeautyCategories] = useState<Category[]>([]);
  const [activity, setActivity] = useState<Record<string, ActivitySeries>>({});
  const [portfolioCount, setPortfolioCount] = useState<Record<string, number>>({});
  const [quality, setQuality] = useState<Record<string, { level: string; score: number }>>({});
  const [loadingData, setLoadingData] = useState(true);
  const [menu, setMenu] = useState<MenuKey>("overview");
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>("avaliacao");
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("pendentes");
  const [deleteTarget, setDeleteTarget] = useState<{ table: "profiles" | "service_requests" | "reviews"; id: string; entity: string } | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Provider | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [categoryToDelete, setCategoryToDelete] = useState<Category | null>(null);
  const [bairroToDelete, setBairroToDelete] = useState<Bairro | null>(null);
  const [bizCategoryToDelete, setBizCategoryToDelete] = useState<Category | null>(null);
  const [belezaCategoryToDelete, setBelezaCategoryToDelete] = useState<Category | null>(null);
  const [notifTitle, setNotifTitle] = useState("");
  const [notifBody, setNotifBody] = useState("");
  const [notifGroups, setNotifGroups] = useState<string[]>([]);
  const [notifSending, setNotifSending] = useState(false);
  const [adminNotifications, setAdminNotifications] = useState<AdminNotification[]>([]);

  useEffect(() => {
    if (loading) return;
    if (!user || !isAdmin) return navigate("/login", { replace: true });
    loadAll();
  }, [user, isAdmin, loading, navigate]);

  const loadAll = async () => {
    setLoadingData(true);
    const [
      { data: p },
      { data: r },
      { data: rv },
      { data: c },
      { data: b },
      { data: st },
      { data: cp },
      { data: act },
      { data: pf },
      { data: ql },
      { data: bc },
      { data: bl },
      { data: an },
    ] = await Promise.all([
      supabase.from("profiles").select("id, name, category, phone, location, price_type, starting_price, photo_url, profile_type, is_verified, verification_status, verification_reason, verification_doc_url, verification_selfie_url").order("name"),
      supabase.from("service_requests").select("id, requester_name, category, location, description, status, created_at").order("created_at", { ascending: false }),
      supabase.from("reviews").select("id, provider_id, reviewer_name, rating, comment, created_at, status").order("created_at", { ascending: false }),
      supabase.from("categories").select("id, name, name_en, name_fr").order("name"),
      supabase.from("bairros").select("id, name").order("name"),
      supabase.from("provider_stats").select("provider_id, profile_views, whatsapp_clicks, call_clicks"),
      supabase.from("complaints").select("id, provider_id, client_id, reason, description, contact, status, created_at").order("created_at", { ascending: false }),
      supabase.from("provider_activity").select("provider_id, activity_type, created_at").order("created_at", { ascending: false }),
      supabase.from("portfolio_images").select("provider_id"),
      supabase.from("quality_levels").select("provider_id, level, score"),
      supabase.from("business_categories").select("id, name, name_en, name_fr").order("name"),
      supabase.from("beauty_categories").select("id, name, name_en, name_fr").order("name"),
      supabase.from("admin_notifications").select("id, title, body, target_groups, sent_by, recipients_count, created_at").order("created_at", { ascending: false }),
    ]);
    const statsMap: Record<string, { profile_views: number; whatsapp_clicks: number; call_clicks: number }> = {};
    (st ?? []).forEach((s) => {
      statsMap[s.provider_id] = { profile_views: s.profile_views ?? 0, whatsapp_clicks: s.whatsapp_clicks ?? 0, call_clicks: s.call_clicks ?? 0 };
    });
    const pfMap: Record<string, number> = {};
    (pf ?? []).forEach((row) => {
      pfMap[row.provider_id] = (pfMap[row.provider_id] ?? 0) + 1;
    });
    const qlMap: Record<string, { level: string; score: number }> = {};
    (ql ?? []).forEach((row) => {
      qlMap[row.provider_id] = { level: row.level, score: row.score };
    });
    setProviders(((p ?? []) as Provider[]).map((prov) => ({ ...prov, stats: statsMap[prov.id] ?? { profile_views: 0, whatsapp_clicks: 0, call_clicks: 0 } })));
    setRequests((r ?? []) as Request[]);
    setReviews((rv ?? []) as Review[]);
    setComplaints((cp ?? []) as Complaint[]);
    setCategories((c ?? []) as Category[]);
    setBairros((b ?? []) as Bairro[]);
    setBusinessCategories((bc ?? []) as Category[]);
    setBeautyCategories((bl ?? []) as Category[]);
    setAdminNotifications((an ?? []) as AdminNotification[]);
    setActivity(buildActivityMap((act ?? []) as { provider_id: string; activity_type: string; created_at: string }[]));
    setPortfolioCount(pfMap);
    setQuality(qlMap);
    setLoadingData(false);
  };

  useEffect(() => {
    if (loading || !user || !isAdmin) return;
    const channel = supabase
      .channel(`admin-live-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "provider_stats" }, () => loadAll())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "provider_activity" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "complaints" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "reviews" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "service_requests" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "quality_levels" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "portfolio_images" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "categories" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "business_categories" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "beauty_categories" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "bairros" }, () => loadAll())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, isAdmin, loading]);

  const remove = async (table: "profiles" | "service_requests" | "reviews", id: string) => {
    const { error } = table === "profiles"
      ? await supabase.rpc("admin_delete_user", { p_profile_id: id })
      : await supabase.from(table).delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(t("admin.deleted"));
    loadAll();
  };

  const toggleVerified = async (p: Provider) => {
    const { error } = await supabase.from("profiles").update({
      is_verified: !p.is_verified,
      verification_status: !p.is_verified ? "aprovado" : "none",
    }).eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success(!p.is_verified ? t("admin.markedVerified") : t("admin.verificationRemoved"));
    loadAll();
  };

  const approveVerification = async (p: Provider) => {
    const { error } = await supabase.from("profiles").update({
      is_verified: true,
      verification_status: "aprovado",
      verification_reason: null,
    }).eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success(`${p.name} ${t("admin.approved")}`);
    loadAll();
  };

  const rejectVerification = async (p: Provider) => {
    const { error } = await supabase.from("profiles").update({
      is_verified: false,
      verification_status: "rejeitado",
      verification_reason: rejectReason.trim() || t("adminExtra.docRejectedDefault"),
    }).eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success(t("admin.rejectedProfile"));
    setRejectTarget(null);
    setRejectReason("");
    loadAll();
  };

  const openVerificationFile = async (path: string | null) => {
    if (!path) return;
    const { data } = await supabase.storage.from("verification").createSignedUrl(path, 300);
    if (!data?.signedUrl) return toast.error(t("admin.fileOpenError"));
    window.open(data.signedUrl, "_blank");
  };

  const approveReview = async (id: string) => {
    const { error } = await supabase.from("reviews").update({ status: "aprovado" }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(t("admin.reviewApproved"));
    loadAll();
  };

  const setComplaintStatus = async (c: Complaint, status: "validada" | "rejeitada") => {
    const { error } = await supabase.from("complaints").update({ status }).eq("id", c.id);
    if (error) return toast.error(error.message);
    toast.success(status === "validada" ? t("admin.complaintValidated") : t("admin.complaintRejected"));
    loadAll();
  };

  const addCategory = async (data: { name: string; name_en: string | null; name_fr: string | null }) => {
    const { error } = await supabase.from("categories").insert({ name: data.name, name_en: data.name_en, name_fr: data.name_fr });
    if (error) return toast.error(error.message);
    toast.success(t("admin.categoryAdded"));
    loadAll();
  };

  const renameCategory = async (id: string, data: { name: string; name_en: string | null; name_fr: string | null }) => {
    const { error } = await supabase.from("categories").update({ name: data.name, name_en: data.name_en, name_fr: data.name_fr }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(t("admin.categoryUpdated"));
    loadAll();
  };

  const removeCategory = async (id: string) => {
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(t("admin.categoryDeleted"));
    loadAll();
  };

  const addBairro = async (name: string) => {
    const { error } = await supabase.from("bairros").insert({ name });
    if (error) return toast.error(error.message);
    toast.success(t("admin.neighborhoodAdded"));
    loadAll();
  };

  const renameBairro = async (id: string, name: string) => {
    const { error } = await supabase.from("bairros").update({ name }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(t("admin.neighborhoodUpdated"));
    loadAll();
  };

  const removeBairro = async (id: string) => {
    const { error } = await supabase.from("bairros").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(t("admin.neighborhoodDeleted"));
    loadAll();
  };

  const addBusinessCategory = async (data: { name: string; name_en: string | null; name_fr: string | null }) => {
    const { error } = await supabase.from("business_categories").insert({ name: data.name, name_en: data.name_en, name_fr: data.name_fr });
    if (error) return toast.error(error.message);
    toast.success(t("admin.shopCategoryAdded"));
    loadAll();
  };

  const renameBusinessCategory = async (id: string, data: { name: string; name_en: string | null; name_fr: string | null }) => {
    const { error } = await supabase.from("business_categories").update({ name: data.name, name_en: data.name_en, name_fr: data.name_fr }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(t("admin.shopCategoryUpdated"));
    loadAll();
  };

  const removeBusinessCategory = async (id: string) => {
    const { error } = await supabase.from("business_categories").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(t("admin.shopCategoryDeleted"));
    loadAll();
  };

  const addBelezaCategory = async (data: { name: string; name_en: string | null; name_fr: string | null }) => {
    const { error } = await supabase.from("beauty_categories").insert({ name: data.name, name_en: data.name_en, name_fr: data.name_fr });
    if (error) return toast.error(error.message);
    toast.success(t("admin.belezaCategoryAdded"));
    loadAll();
  };

  const renameBelezaCategory = async (id: string, data: { name: string; name_en: string | null; name_fr: string | null }) => {
    const { error } = await supabase.from("beauty_categories").update({ name: data.name, name_en: data.name_en, name_fr: data.name_fr }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(t("admin.belezaCategoryUpdated"));
    loadAll();
  };

  const removeBelezaCategory = async (id: string) => {
    const { error } = await supabase.from("beauty_categories").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(t("admin.belezaCategoryDeleted"));
    loadAll();
  };

  const sendBulkNotification = async () => {
    if (!notifTitle.trim() || !notifBody.trim()) {
      toast.error(t("admin.notifRequiredFields"));
      return;
    }
    if (notifGroups.length === 0) {
      toast.error(t("admin.notifRequiredGroup"));
      return;
    }
    setNotifSending(true);
    const { data, error } = await supabase.rpc("send_bulk_notification", {
      p_title: notifTitle.trim(),
      p_body: notifBody.trim(),
      p_target_groups: notifGroups,
    });
    setNotifSending(false);
    if (error) return toast.error(error.message);
    toast.success(t("admin.notifSent", { count: data ?? 0 }));
    setNotifTitle("");
    setNotifBody("");
    setNotifGroups([]);
    loadAll();
  };

  const providerName = (pid: string) => providers.find((p) => p.id === pid)?.name ?? t("admin.client");
  const profileUrl = (p: Provider) => (p.profile_type === "business" ? `/loja/${p.id}` : p.profile_type === "beleza" ? `/beleza/${p.id}` : `/prestador/${p.id}`);
  const providerLink = (pid: string) => {
    const p = providers.find((x) => x.id === pid);
    return p ? profileUrl(p) : `/prestador/${pid}`;
  };
  const pendingReviews = reviews.filter((r) => r.status === "pendente");
  const approvedReviews = reviews.filter((r) => r.status === "aprovado");
  const pendingVerifications = providers.filter((p) => p.verification_status === "pendente");
  const pendingComplaints = complaints.filter((c) => c.status === "pendente");
  const reviewedComplaints = complaints.filter((c) => c.status !== "pendente");
  const clientName = (cid: string | null) => (cid ? providers.find((p) => p.id === cid)?.name ?? t("admin.client") : t("admin.anonymous"));

  const filteredProviders = useMemo(() => {
    if (providerFilter === "avaliacao") return providers.filter((p) => p.verification_status === "pendente");
    if (providerFilter === "ativos") return providers.filter((p) => p.is_verified || p.verification_status === "aprovado");
    if (providerFilter === "rejeitados") return providers.filter((p) => p.verification_status === "rejeitado");
    return providers;
  }, [providers, providerFilter]);

  const filteredReviews = useMemo(() => (reviewFilter === "pendentes" ? pendingReviews : approvedReviews), [reviewFilter, pendingReviews, approvedReviews]);

  const avgRating = useMemo(() => {
    if (!approvedReviews.length) return 0;
    return Math.round((approvedReviews.reduce((s, r) => s + r.rating, 0) / approvedReviews.length) * 10) / 10;
  }, [approvedReviews]);

  const topProviders = useMemo(
    () => [...providers].sort((a, b) => (b.stats?.profile_views ?? 0) - (a.stats?.profile_views ?? 0)).slice(0, 5),
    [providers]
  );

  const statusBadge = (p: Provider) => {
    const key = p.verification_status || (p.is_verified ? "aprovado" : "none");
    const s = STATUS_BADGE_KEYS[key] ?? STATUS_BADGE_KEYS.none;
    return <Badge className={s.className}>{t(s.key)}</Badge>;
  };

  const qualityLabel = (p: Provider) => {
    const q = quality[p.id];
    if (!q) return { label: "—", className: "text-muted-foreground" };
    const map: Record<string, string> = { alta: "text-green-700", media: "text-yellow-600", baixa: "text-red-600" };
    return { label: q.level, className: map[q.level] ?? "text-muted-foreground" };
  };

  const providerCard = (p: Provider) => {
    const series = activity[p.id] ?? { vista: [], whatsapp: [], call: [] };
    const q = qualityLabel(p);
    return (
      <Card key={p.id}>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Avatar className="h-12 w-12 rounded-xl shrink-0">
              {p.photo_url ? <AvatarImage src={p.photo_url} alt={p.name} className="object-cover" /> : null}
              <AvatarFallback className="rounded-xl bg-primary/10 text-primary font-bold">{p.name.charAt(0)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <Link to={profileUrl(p)} className="font-semibold hover:underline inline-flex items-center gap-1">
                  {p.name}
                  {p.is_verified && <BadgeCheck className="h-4 w-4 text-primary" />}
                </Link>
                {p.profile_type === "business" && <Badge variant="outline" className="text-[10px]">{t("admin.shop")}</Badge>}
                {statusBadge(p)}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {p.category} · {p.location} · {p.phone}
                {p.price_type === "fixo" && p.starting_price != null && ` · ${formatCFA(p.starting_price)}`}
                {p.price_type === "negociavel" && ` · ${t("common.negotiable")}`}
                {p.price_type === "combinar" && ` · ${t("common.toCombine")}`}
              </div>
            </div>
            <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setDeleteTarget({ table: "profiles", id: p.id, entity: `o perfil de ${p.name}` })}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 pt-4 border-t">
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t("admin.performance")}</div>
              <div className="flex flex-col gap-3">
                <div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><Eye className="h-3.5 w-3.5" /> {t("admin.views")}</span>
                    <span className="font-semibold">{p.stats?.profile_views ?? 0}</span>
                  </div>
                  <MiniBars data={series.vista} color="bg-green-600" />
                </div>
                <div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" /> {t("admin.whatsapp")}</span>
                    <span className="font-semibold">{p.stats?.whatsapp_clicks ?? 0}</span>
                  </div>
                  <MiniBars data={series.whatsapp} color="bg-emerald-500" />
                </div>
                <div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> {t("admin.calls")}</span>
                    <span className="font-semibold">{p.stats?.call_clicks ?? 0}</span>
                  </div>
                  <MiniBars data={series.call} color="bg-teal-500" />
                </div>
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t("admin.profileStatus")}</div>
              <dl className="flex flex-col gap-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground text-xs">{t("admin.identityVerified")}</dt>
                  <dd className="font-medium">{p.is_verified ? t("admin.yes") : t("admin.no")}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground text-xs">{t("admin.verificationStatus")}</dt>
                  <dd>{statusBadge(p)}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground text-xs inline-flex items-center gap-1"><Images className="h-3.5 w-3.5" /> {t("admin.portfolioPhotos")}</dt>
                  <dd className="font-medium">{(portfolioCount[p.id] ?? 0) > 0 ? `${t("admin.yes")} (${portfolioCount[p.id]})` : t("admin.no")}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground text-xs">{t("admin.qualityLevel")}</dt>
                  <dd className={`font-medium capitalize ${q.className}`}>{q.label}</dd>
                </div>
                {p.verification_reason && (
                  <p className="text-xs text-red-600 bg-red-50 rounded-lg p-2">{t("admin.reason", { reason: p.verification_reason })}</p>
                )}
              </dl>
            </div>

            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t("admin.actions")}</div>
              <div className="flex flex-col gap-1.5">
                {p.is_verified ? (
                  <Button variant="outline" size="sm" onClick={() => toggleVerified(p)} className="gap-1">
                    <BadgeCheck className="h-3.5 w-3.5" /> {t("admin.removeBadge")}
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => approveVerification(p)} className="gap-1 bg-green-600 hover:bg-green-700 text-white">
                    <Check className="h-3.5 w-3.5" /> {t("admin.approveProfile")}
                  </Button>
                )}
                <Button size="sm" variant="destructive" onClick={() => setRejectTarget(p)} className="gap-1">
                  <X className="h-3.5 w-3.5" /> {t("admin.reject")}
                </Button>
                {p.verification_doc_url || p.verification_selfie_url ? (
                  <Button variant="outline" size="sm" onClick={() => openVerificationFile(p.verification_doc_url ?? p.verification_selfie_url)} className="gap-1">
                    <ShieldCheck className="h-3.5 w-3.5" /> {t("admin.viewDocument")}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  if (loading || loadingData) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">{t("admin.loading")}</div>;

  const menuItems: { key: MenuKey; label: string; icon: React.ReactNode; count?: number }[] = [
    { key: "overview", label: t("admin.overview"), icon: <LayoutDashboard className="h-4 w-4" /> },
    { key: "providers", label: t("admin.providers"), icon: <Users className="h-4 w-4" />, count: providers.length },
    { key: "verifications", label: t("admin.verifications"), icon: <ShieldCheck className="h-4 w-4" />, count: pendingVerifications.length },
    { key: "complaints", label: t("admin.complaints"), icon: <ShieldAlert className="h-4 w-4" />, count: pendingComplaints.length },
    { key: "reviews", label: t("admin.reviews"), icon: <Star className="h-4 w-4" />, count: pendingReviews.length },
    { key: "requests", label: t("admin.requests"), icon: <ClipboardList className="h-4 w-4" />, count: requests.length },
    { key: "categories", label: t("admin.categories"), icon: <Tag className="h-4 w-4" />, count: categories.length },
    { key: "lojas-categorias", label: t("admin.shopCategories"), icon: <Store className="h-4 w-4" />, count: businessCategories.length },
    { key: "beleza-categorias", label: t("admin.belezaCategories"), icon: <Scissors className="h-4 w-4" />, count: beautyCategories.length },
    { key: "bairros", label: t("admin.neighborhoods"), icon: <MapPin className="h-4 w-4" />, count: bairros.length },
    { key: "stats", label: t("admin.statistics"), icon: <BarChart3 className="h-4 w-4" /> },
    { key: "send_notification", label: t("admin.sendNotification"), icon: <Bell className="h-4 w-4" /> },
    { key: "settings", label: t("admin.settings"), icon: <Settings className="h-4 w-4" /> },
  ];

  const navList = (compact = false) => (
    <nav className={compact ? "flex md:hidden gap-1 overflow-x-auto px-4 py-2" : "flex flex-col gap-1"}>
      {menuItems.map((item) => (
        <button
          key={item.key}
          onClick={() => setMenu(item.key)}
          className={
            compact
              ? "flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded-lg text-sm " +
                (menu === item.key ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted")
              : "flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm text-left " +
                (menu === item.key ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted")
          }
        >
          <span className="flex items-center gap-2.5">
            {item.icon}
            <span>{item.label}</span>
          </span>
          {typeof item.count === "number" && item.count > 0 ? (
            <span className={"text-xs rounded-full px-1.5 py-0.5 min-w-5 text-center " + (menu === item.key ? "bg-primary text-white" : "bg-muted text-muted-foreground")}>
              {item.count}
            </span>
          ) : null}
        </button>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      <aside className="hidden md:flex md:flex-col md:w-64 md:shrink-0 md:sticky md:top-0 md:h-screen md:border-r bg-card">
        <div className="px-5 py-4 border-b flex items-center gap-2">
          <img src={logo} alt="Bornaal" className="h-8 w-auto" />
        </div>
        <div className="flex-1 p-3 overflow-y-auto">{navList()}</div>
        <div className="p-3 border-t flex items-center justify-between gap-2">
          <Badge variant="secondary">{t("admin.administrator")}</Badge>
          <Button variant="ghost" size="sm" onClick={() => signOut().then(() => navigate("/"))} className="gap-1">
            <LogOut className="h-4 w-4" /> {t("admin.logout")}
          </Button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="border-b md:hidden">
          <div className="px-4 py-2 flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2">
              <img src={logo} alt="Bornaal" className="h-7 w-auto" />
            </Link>
            <div className="flex items-center gap-2">
              <LanguageSelector />
              <Badge variant="secondary">{t("admin.admin")}</Badge>
              <Button variant="ghost" size="icon" onClick={() => signOut().then(() => navigate("/"))}>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {navList(true)}
        </header>
        <header className="hidden md:flex border-b px-6 py-3 items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link to="/" className="hover:text-foreground inline-flex items-center gap-1">
              {t("common.home")}
            </Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="text-foreground font-medium">{menuItems.find((m) => m.key === menu)?.label}</span>
          </div>
          <LanguageSelector />
        </header>

        <main className="flex-1 p-4 md:p-6 w-full max-w-5xl">
          {menu === "overview" && (
            <div className="flex flex-col gap-4">
              <h1 className="text-2xl font-bold">{t("admin.overview")}</h1>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <StatCard label={t("admin.providers")} value={providers.length} icon={<Users className="h-5 w-5" />} onClick={() => setMenu("providers")} />
                <StatCard label={t("admin.pendingVerifications")} value={pendingVerifications.length} icon={<ShieldCheck className="h-5 w-5" />} onClick={() => setMenu("verifications")} />
                <StatCard label={t("admin.pendingReviews")} value={pendingReviews.length} icon={<Star className="h-5 w-5" />} onClick={() => setMenu("reviews")} />
                <StatCard label={t("admin.pendingComplaints")} value={pendingComplaints.length} icon={<ShieldAlert className="h-5 w-5" />} onClick={() => setMenu("complaints")} />
                <StatCard label={t("admin.requests")} value={requests.length} icon={<ClipboardList className="h-5 w-5" />} onClick={() => setMenu("requests")} />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card>
                  <CardContent className="p-4">
                    <h2 className="font-semibold text-sm mb-3">{t("admin.recentRequests")}</h2>
                    {requests.slice(0, 5).map((r) => (
                      <div key={r.id} className="py-2 border-b last:border-0 text-sm">
                        <div className="font-medium">{r.requester_name ?? t("admin.client")}</div>
                        <div className="text-xs text-muted-foreground">{r.category} · {r.location}</div>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{r.description}</p>
                      </div>
                    ))}
                    {!requests.length && <p className="text-sm text-muted-foreground text-center py-6">{t("admin.noRequests")}</p>}
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <h2 className="font-semibold text-sm mb-3">{t("admin.recentComplaints")}</h2>
                    {complaints.slice(0, 5).map((c) => (
                      <div key={c.id} className="py-2 border-b last:border-0 text-sm">
                        <div className="font-medium">{providerName(c.provider_id)}</div>
                        <div className="text-xs text-muted-foreground">{c.reason} · {clientName(c.client_id)}</div>
                        <Badge variant={c.status === "pendente" ? "destructive" : c.status === "validada" ? "default" : "secondary"} className="mt-1">{c.status}</Badge>
                      </div>
                    ))}
                    {!complaints.length && <p className="text-sm text-muted-foreground text-center py-6">{t("admin.noComplaints")}</p>}
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {menu === "providers" && (
            <div className="flex flex-col gap-4">
              <h1 className="text-2xl font-bold">{t("admin.providers")}</h1>
              <Tabs value={providerFilter} onValueChange={(v) => setProviderFilter(v as ProviderFilter)}>
                <div className="overflow-x-auto -mx-4 px-4 mb-4">
                  <TabsList className="inline-flex w-max gap-1">
                    <TabsTrigger value="avaliacao">{t("admin.inReviewCount", { count: providers.filter((p) => p.verification_status === "pendente").length })}</TabsTrigger>
                    <TabsTrigger value="ativos">{t("admin.activeCount", { count: providers.filter((p) => p.is_verified || p.verification_status === "aprovado").length })}</TabsTrigger>
                    <TabsTrigger value="rejeitados">{t("admin.rejectedCount", { count: providers.filter((p) => p.verification_status === "rejeitado").length })}</TabsTrigger>
                    <TabsTrigger value="todos">{t("admin.allCount", { count: providers.length })}</TabsTrigger>
                  </TabsList>
                </div>
                <TabsContent value={providerFilter} className="flex flex-col gap-3">
                  {filteredProviders.map(providerCard)}
                  {!filteredProviders.length && <p className="text-sm text-muted-foreground text-center py-6">{t("admin.noProvidersState")}</p>}
                </TabsContent>
              </Tabs>
            </div>
          )}

          {menu === "verifications" && (
            <div className="flex flex-col gap-4">
              <h1 className="text-2xl font-bold">{t("admin.verifications")}</h1>
              <p className="text-sm text-muted-foreground">{t("admin.verificationsDesc")}</p>
              <div className="flex flex-col gap-3">
                {pendingVerifications.map((p) => (
                  <Card key={p.id} className="border-yellow-500/40">
                    <CardContent className="p-3 flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Link to={profileUrl(p)} className="font-semibold hover:underline inline-flex items-center gap-1">
                            {p.name}
                            {p.is_verified && <BadgeCheck className="h-4 w-4 text-primary" />}
                          </Link>
                          <Badge className="bg-yellow-100 text-yellow-700">{t("admin.inReviewTab")}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">{p.category} · {p.location} · {p.phone}</div>
                        <div className="flex flex-wrap gap-2 mt-2">
                          <Button variant="outline" size="sm" onClick={() => openVerificationFile(p.verification_doc_url)}>
                            {t("admin.viewDocument")}
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => openVerificationFile(p.verification_selfie_url)}>
                            {t("admin.viewSelfie")}
                          </Button>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        <Button size="sm" onClick={() => approveVerification(p)} className="gap-1 bg-green-600 hover:bg-green-700 text-white">
                          <Check className="h-3.5 w-3.5" /> {t("admin.approve")}
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => setRejectTarget(p)} className="gap-1">
                          <X className="h-3.5 w-3.5" /> {t("admin.reject")}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {!pendingVerifications.length && <p className="text-sm text-muted-foreground text-center py-6">{t("admin.noPendingVerifications")}</p>}
              </div>
            </div>
          )}

          {menu === "complaints" && (
            <div className="flex flex-col gap-4">
              <h1 className="text-2xl font-bold">{t("admin.complaints")}</h1>
              <div className="flex flex-col gap-3">
                {pendingComplaints.map((c) => (
                  <Card key={c.id} className="border-red-500/40">
                    <CardContent className="p-3 flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="destructive" className="gap-1">⚠ {t("admin.pending")}</Badge>
                          <span className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleString(i18n.language)}</span>
                        </div>
                        <div className="mt-1.5 text-sm">
                          <span className="text-muted-foreground">{t("admin.providerLabel")}</span>{" "}
                          <Link to={providerLink(c.provider_id)} className="font-semibold hover:underline">
                            {providerName(c.provider_id)}
                          </Link>
                        </div>
                        <div className="text-sm text-muted-foreground">{t("admin.complainant")} {clientName(c.client_id)}</div>
                        {c.contact && (
                          <div className="text-sm mt-1">
                            <span className="text-muted-foreground">{t("admin.complainantContact")}</span>{" "}
                            <a href={`tel:${c.contact}`} className="font-semibold text-primary hover:underline">{c.contact}</a>
                          </div>
                        )}
                        <div className="text-sm mt-1">
                          <Badge variant="secondary">{c.reason}</Badge>
                        </div>
                        {c.description && <p className="text-sm mt-2 bg-muted rounded-lg p-2">{c.description}</p>}
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        <Button size="sm" onClick={() => setComplaintStatus(c, "validada")} className="gap-1 bg-green-600 hover:bg-green-700 text-white">
                          <Check className="h-3.5 w-3.5" /> {t("admin.validate")}
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => setComplaintStatus(c, "rejeitada")} className="gap-1">
                          <X className="h-3.5 w-3.5" /> {t("admin.reject")}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {!pendingComplaints.length && <p className="text-sm text-muted-foreground text-center py-6">{t("admin.noPendingComplaints")}</p>}

                {reviewedComplaints.length > 0 && (
                  <div className="mt-2">
                    <h3 className="text-sm font-semibold mb-2 text-muted-foreground">{t("admin.reviewedCount", { count: reviewedComplaints.length })}</h3>
                    {reviewedComplaints.map((c) => (
                      <Card key={c.id} className={c.status === "validada" ? "border-green-500/40" : "border-muted"}>
                        <CardContent className="p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={c.status === "validada" ? "default" : "secondary"}>
                              {c.status === "validada" ? `✓ ${t("admin.validated")}` : `✕ ${t("admin.rejectedStatus")}`}
                            </Badge>
                            <span className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleString(i18n.language)}</span>
                          </div>
                          <div className="mt-1.5 text-sm">
                            <span className="text-muted-foreground">{t("admin.providerLabel")}</span>{" "}
                            <Link to={providerLink(c.provider_id)} className="font-semibold hover:underline">
                              {providerName(c.provider_id)}
                            </Link>{" "}
                            <span className="text-muted-foreground">· {t("admin.complainant")} {clientName(c.client_id)}</span>
                          </div>
                          <div className="text-sm mt-1"><Badge variant="secondary">{c.reason}</Badge></div>
                          {c.contact && (
                            <div className="text-sm mt-1">
                              <span className="text-muted-foreground">{t("admin.complainantContact")}</span>{" "}
                              <a href={`tel:${c.contact}`} className="font-semibold text-primary hover:underline">{c.contact}</a>
                            </div>
                          )}
                          {c.description && <p className="text-sm mt-2 bg-muted rounded-lg p-2">{c.description}</p>}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {menu === "reviews" && (
            <div className="flex flex-col gap-4">
              <h1 className="text-2xl font-bold">{t("admin.reviews")}</h1>
              <Tabs value={reviewFilter} onValueChange={(v) => setReviewFilter(v as ReviewFilter)}>
                <div className="overflow-x-auto -mx-4 px-4 mb-4">
                  <TabsList className="inline-flex w-max gap-1">
                    <TabsTrigger value="pendentes">{t("admin.pendingReviewsCount", { count: pendingReviews.length })}</TabsTrigger>
                    <TabsTrigger value="aprovadas">{t("admin.approvedReviewsCount", { count: approvedReviews.length })}</TabsTrigger>
                  </TabsList>
                </div>
                <TabsContent value={reviewFilter} className="flex flex-col gap-2">
                  {filteredReviews.map((r) =>
                    reviewFilter === "pendentes" ? (
                      <Card key={r.id} className="border-yellow-500/40">
                        <CardContent className="p-3 flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-xs text-muted-foreground">{t("admin.providerLabel")}</div>
                            <Link to={providerLink(r.provider_id)} className="font-semibold hover:underline text-sm">
                              {providerName(r.provider_id)}
                            </Link>
                            <div className="text-sm mt-1">
                              <span className="font-medium">{r.reviewer_name ?? t("admin.anonymous")}</span> · {r.rating}★
                            </div>
                            {r.comment && <p className="text-sm text-muted-foreground mt-1">{r.comment}</p>}
                          </div>
                          <div className="flex flex-col gap-1 shrink-0">
                            <Button size="sm" onClick={() => approveReview(r.id)} className="gap-1 bg-green-600 hover:bg-green-700 text-white">
                              <Check className="h-3.5 w-3.5" /> {t("admin.approve")}
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => setDeleteTarget({ table: "reviews", id: r.id, entity: t("admin.reviews") })} className="gap-1">
                              <X className="h-3.5 w-3.5" /> {t("admin.reject")}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ) : (
                      <Card key={r.id}>
                        <CardContent className="p-3 flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold">{r.reviewer_name ?? t("admin.anonymous")} · {r.rating}★</div>
                            {r.comment && <p className="text-sm text-muted-foreground">{r.comment}</p>}
                            <Link to={providerLink(r.provider_id)} className="text-xs text-primary hover:underline">{t("admin.viewProvider")}</Link>
                          </div>
                          <Button variant="ghost" size="icon" onClick={() => setDeleteTarget({ table: "reviews", id: r.id, entity: t("admin.reviews") })}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </CardContent>
                      </Card>
                    )
                  )}
                  {!filteredReviews.length && <p className="text-sm text-muted-foreground text-center py-6">{t("admin.noReviews")}</p>}
                </TabsContent>
              </Tabs>
            </div>
          )}

          {menu === "requests" && (
            <div className="flex flex-col gap-4">
              <h1 className="text-2xl font-bold">{t("admin.requests")}</h1>
              <div className="flex flex-col gap-2">
                {requests.map((r) => (
                  <Card key={r.id}>
                    <CardContent className="p-3 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold flex items-center gap-2">
                          {r.requester_name ?? t("admin.client")}
                          <Badge variant={r.status === "aberto" ? "secondary" : r.status === "concluido" ? "default" : "outline"}>
                            {r.status}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mb-1">{r.category} · {r.location}</div>
                        <p className="text-sm">{r.description}</p>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteTarget({ table: "service_requests", id: r.id, entity: t("admin.requests") })}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </CardContent>
                  </Card>
                ))}
                {!requests.length && <p className="text-sm text-muted-foreground text-center py-6">{t("admin.noRequestsTab")}</p>}
              </div>
            </div>
          )}

          {menu === "categories" && (
            <div className="flex flex-col gap-4">
              <h1 className="text-2xl font-bold">{t("admin.categories")}</h1>
              <p className="text-xs text-muted-foreground">
                Crie a categoria em PT e adicione as traduções em inglês e francês. O nome em PT é o identificador guardado nos perfis.
              </p>
              <ManageCategoryList
                items={categories}
                onAdd={addCategory}
                onRename={renameCategory}
                onDelete={(id) => setCategoryToDelete(categories.find((c) => c.id === id) ?? null)}
                emptyText={t("admin.noCategories")}
              />
            </div>
          )}

          {menu === "lojas-categorias" && (
            <div className="flex flex-col gap-4">
              <h1 className="text-2xl font-bold">{t("admin.shopCategories")}</h1>
              <p className="text-xs text-muted-foreground">
                {t("admin.shopCategoriesDesc")}
              </p>
              <p className="text-xs text-muted-foreground">
                Tradução: preencha EN e FR para cada categoria. Exibida conforme o idioma do utilizador.
              </p>
              <ManageCategoryList
                items={businessCategories}
                onAdd={addBusinessCategory}
                onRename={renameBusinessCategory}
                onDelete={(id) => setBizCategoryToDelete(businessCategories.find((c) => c.id === id) ?? null)}
                emptyText={t("admin.noShopCategories")}
              />
            </div>
          )}

          {menu === "beleza-categorias" && (
            <div className="flex flex-col gap-4">
              <h1 className="text-2xl font-bold">{t("admin.belezaCategories")}</h1>
              <p className="text-xs text-muted-foreground">
                {t("admin.belezaCategoriesDesc")}
              </p>
              <p className="text-xs text-muted-foreground">
                Tradução: preencha EN e FR para cada subcategoria. Exibida conforme o idioma do utilizador.
              </p>
              <ManageCategoryList
                items={beautyCategories}
                onAdd={addBelezaCategory}
                onRename={renameBelezaCategory}
                onDelete={(id) => setBelezaCategoryToDelete(beautyCategories.find((c) => c.id === id) ?? null)}
                emptyText={t("admin.noBelezaCategories")}
              />
            </div>
          )}

          {menu === "bairros" && (
            <div className="flex flex-col gap-4">
              <h1 className="text-2xl font-bold">{t("admin.neighborhoods")}</h1>
              <ManageList
                placeholder={t("admin.newNeighborhoodPlaceholder")}
                items={bairros}
                onAdd={addBairro}
                onRename={renameBairro}
                onDelete={(id) => setBairroToDelete(bairros.find((b) => b.id === id) ?? null)}
                emptyText={t("admin.noNeighborhoods")}
              />
            </div>
          )}

          {menu === "stats" && (
            <div className="flex flex-col gap-4">
              <h1 className="text-2xl font-bold">{t("admin.statistics")}</h1>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <StatCard label={t("admin.providers")} value={providers.length} icon={<Users className="h-5 w-5" />} onClick={() => setMenu("providers")} />
                <StatCard label={t("admin.requests")} value={requests.length} icon={<ClipboardList className="h-5 w-5" />} onClick={() => setMenu("requests")} />
                <StatCard label={t("admin.approvedReviews")} value={approvedReviews.length} icon={<Star className="h-5 w-5" />} onClick={() => setMenu("reviews")} />
                <StatCard label={t("admin.validatedComplaints")} value={complaints.filter((c) => c.status === "validada").length} icon={<ShieldAlert className="h-5 w-5" />} onClick={() => setMenu("complaints")} />
                <StatCard label={t("admin.avgRating")} value={avgRating} icon={<Star className="h-5 w-5" />} onClick={() => setMenu("reviews")} />
              </div>
              <Card>
                <CardContent className="p-4">
                  <h2 className="font-semibold text-sm mb-3">{t("admin.topProviders")}</h2>
                  <div className="flex flex-col gap-2">
                    {topProviders.map((p, i) => (
                      <div key={p.id} className="flex items-center gap-3 py-2 border-b last:border-0 text-sm">
                        <span className="w-5 text-muted-foreground font-medium">{i + 1}º</span>
                        <Avatar className="h-8 w-8 rounded-lg shrink-0">
                          {p.photo_url ? <AvatarImage src={p.photo_url} alt={p.name} className="object-cover" /> : null}
                          <AvatarFallback className="rounded-lg bg-primary/10 text-primary text-xs font-bold">{p.name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <Link to={profileUrl(p)} className="font-medium hover:underline">{p.name}</Link>
                          <div className="text-xs text-muted-foreground">{p.category} · {p.location}</div>
                        </div>
                        <div className="flex gap-3 text-xs text-muted-foreground shrink-0">
                          <span className="inline-flex items-center gap-1"><Eye className="h-3.5 w-3.5" /> {p.stats?.profile_views ?? 0}</span>
                          <span className="inline-flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" /> {p.stats?.whatsapp_clicks ?? 0}</span>
                          <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> {p.stats?.call_clicks ?? 0}</span>
                        </div>
                      </div>
                    ))}
                    {!topProviders.length && <p className="text-sm text-muted-foreground text-center py-6">{t("admin.noProviders")}</p>}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {menu === "send_notification" && (
            <div className="flex flex-col gap-6 max-w-2xl">
              <h1 className="text-2xl font-bold">{t("admin.sendNotification")}</h1>

              <Card>
                <CardContent className="p-4 flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium">{t("admin.notifTitle")}</label>
                    <input
                      type="text"
                      value={notifTitle}
                      onChange={(e) => setNotifTitle(e.target.value)}
                      placeholder={t("admin.notifTitlePlaceholder")}
                      className="w-full border rounded-lg px-3 py-2 text-sm bg-background"
                      maxLength={120}
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium">{t("admin.notifMessage")}</label>
                    <textarea
                      value={notifBody}
                      onChange={(e) => setNotifBody(e.target.value)}
                      placeholder={t("admin.notifMessagePlaceholder")}
                      className="w-full border rounded-lg px-3 py-2 text-sm bg-background min-h-[80px] resize-none"
                      maxLength={500}
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium">{t("admin.notifTarget")}</label>
                    <div className="flex flex-wrap gap-3">
                      {[
                        { value: "provider", label: t("admin.notifProviders") },
                        { value: "business", label: t("admin.notifBusinesses") },
                        { value: "beleza", label: t("admin.notifBeleza") },
                        { value: "client", label: t("admin.notifClients") },
                      ].map((g) => (
                        <label key={g.value} className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={notifGroups.includes(g.value)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setNotifGroups((prev) => [...prev, g.value]);
                              } else {
                                setNotifGroups((prev) => prev.filter((x) => x !== g.value));
                              }
                            }}
                            className="rounded"
                          />
                          {g.label}
                        </label>
                      ))}
                    </div>
                  </div>

                  <Button
                    onClick={sendBulkNotification}
                    disabled={notifSending || !notifTitle.trim() || !notifBody.trim() || notifGroups.length === 0}
                    className="gap-2 self-start"
                  >
                    <Send className="h-4 w-4" />
                    {notifSending ? t("admin.notifSending") : t("admin.notifSend")}
                  </Button>
                </CardContent>
              </Card>

              <div>
                <h2 className="text-lg font-semibold mb-3">{t("admin.notifHistory")}</h2>
                {adminNotifications.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">{t("admin.notifNoHistory")}</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {adminNotifications.map((n) => (
                      <Card key={n.id}>
                        <CardContent className="p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-medium text-sm">{n.title}</div>
                              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                              <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-muted-foreground">
                                <span>{new Date(n.created_at).toLocaleString(i18n.language)}</span>
                                <span>·</span>
                                <span>{n.recipients_count} {t("admin.notifRecipients")}</span>
                                <span>·</span>
                                <span>{n.target_groups.map((g) => {
                                  if (g === "provider") return t("admin.notifProviders");
                                  if (g === "business") return t("admin.notifBusinesses");
                                  if (g === "beleza") return t("admin.notifBeleza");
                                  if (g === "client") return t("admin.notifClients");
                                  return g;
                                }).join(", ")}</span>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {menu === "settings" && (
            <div className="flex flex-col gap-4 max-w-lg">
              <h1 className="text-2xl font-bold">{t("admin.settings")}</h1>
              <Card>
                <CardContent className="p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{t("admin.administrator")}</span>
                    <span className="font-medium">{user?.email}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{t("admin.platform")}</span>
                    <span className="font-medium">{t("admin.bornaal")}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{t("admin.categories")}</span>
                    <span className="font-medium">{categories.length}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{t("admin.neighborhoods")}</span>
                    <span className="font-medium">{bairros.length}</span>
                  </div>
                </CardContent>
              </Card>
              <p className="text-xs text-muted-foreground">
                {t("admin.advancedSettings")}
              </p>
            </div>
          )}
        </main>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
        title={t("admin.delete")}
        description={deleteTarget ? t("admin.deleteConfirm", { entity: deleteTarget.entity }) : ""}
        confirmLabel={t("admin.delete")}
        destructive
        onConfirm={() => {
          if (deleteTarget) remove(deleteTarget.table, deleteTarget.id);
          setDeleteTarget(null);
        }}
      />

      <ConfirmDialog
        open={rejectTarget !== null}
        onOpenChange={(o) => { if (!o) { setRejectTarget(null); setRejectReason(""); } }}
        title={t("admin.rejectName", { name: rejectTarget?.name ?? "" })}
        description={t("admin.rejectReasonHint")}
        confirmLabel={t("admin.reject")}
        destructive
        input={{
          label: t("admin.rejectionReason"),
          placeholder: t("admin.rejectionPlaceholder"),
          value: rejectReason,
          onChange: setRejectReason,
        }}
        onConfirm={() => { if (rejectTarget) rejectVerification(rejectTarget); }}
      />

      <ConfirmDialog
        open={categoryToDelete !== null}
        onOpenChange={(o) => { if (!o) setCategoryToDelete(null); }}
        title={t("admin.deleteCategory")}
        description={categoryToDelete ? t("admin.deleteCategoryConfirm", { name: categoryToDelete.name }) : ""}
        confirmLabel={t("admin.delete")}
        destructive
        onConfirm={() => {
          if (categoryToDelete) removeCategory(categoryToDelete.id);
          setCategoryToDelete(null);
        }}
      />

      <ConfirmDialog
        open={bizCategoryToDelete !== null}
        onOpenChange={(o) => { if (!o) setBizCategoryToDelete(null); }}
        title={t("admin.deleteShopCategory")}
        description={bizCategoryToDelete ? t("admin.deleteCategoryConfirm", { name: bizCategoryToDelete.name }) : ""}
        confirmLabel={t("admin.delete")}
        destructive
        onConfirm={() => {
          if (bizCategoryToDelete) removeBusinessCategory(bizCategoryToDelete.id);
          setBizCategoryToDelete(null);
        }}
      />

      <ConfirmDialog
        open={belezaCategoryToDelete !== null}
        onOpenChange={(o) => { if (!o) setBelezaCategoryToDelete(null); }}
        title={t("admin.deleteBelezaCategory")}
        description={belezaCategoryToDelete ? t("admin.deleteCategoryConfirm", { name: belezaCategoryToDelete.name }) : ""}
        confirmLabel={t("admin.delete")}
        destructive
        onConfirm={() => {
          if (belezaCategoryToDelete) removeBelezaCategory(belezaCategoryToDelete.id);
          setBelezaCategoryToDelete(null);
        }}
      />

      <ConfirmDialog
        open={bairroToDelete !== null}
        onOpenChange={(o) => { if (!o) setBairroToDelete(null); }}
        title={t("admin.deleteNeighborhood")}
        description={bairroToDelete ? t("admin.deleteNeighborhoodConfirm", { name: bairroToDelete.name }) : ""}
        confirmLabel={t("admin.delete")}
        destructive
        onConfirm={() => {
          if (bairroToDelete) removeBairro(bairroToDelete.id);
          setBairroToDelete(null);
        }}
      />
    </div>
  );
};

export default AdminDashboard;
