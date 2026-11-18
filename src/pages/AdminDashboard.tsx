import { useQuery } from "@tanstack/react-query";
import { LoadError } from "@/components/LoadError";
import { Pagination } from "@/components/Pagination";
import { useEffect, useMemo, useState } from "react";
import { BUCKET_PRIVADO } from "@/lib/armazenamentoPrivado";
import { ImagemPrivada } from "@/components/MediaPrivada";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  LogOut,
  Trash2,
  BadgeCheck,
  Check,
  X,
  LayoutDashboard,
  ShieldCheck,
  ShieldAlert,
  Star,
  ClipboardList,
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
  Coins,
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
import logo from "@/assets/itudoo-logo-preto.png";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { LanguageSelector } from "@/components/LanguageSelector";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useAllCommissions, useAllCommissionPayments, useValidateCommissionPayment, usePlatformSettings, useUpdatePlatformSetting } from "@/hooks/useCommission";

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
type Review = { id: string; provider_id: string; reviewer_name: string | null; rating: number; comment: string | null; created_at: string; status: string };
type Complaint = { id: string; provider_id: string; client_id: string | null; reason: string; description: string | null; contact: string | null; status: string; created_at: string };
type Category = { id: string; name: string; name_en?: string | null; name_fr?: string | null };
type Bairro = { id: string; name: string };
type ActivityType = "vista" | "whatsapp" | "call";
type ActivitySeries = Record<ActivityType, number[]>;
const NOTIFICATION_AUDIENCES = {
  client: "admin.notifClients",
  business: "admin.restaurants",
  fleet: "admin.notifFleets",
  driver: "admin.notifDrivers",
} as const;

const NOTIFICATION_AUDIENCE_LABELS: Record<string, string> = {
  ...NOTIFICATION_AUDIENCES,
  provider: "admin.notifProviders",
  beleza: "admin.notifBeleza",
  admin: "admin.administrator",
};

type AdminNotification = { id: string; title: string; body: string; target_groups: string[]; sent_by: string; recipients_count: number; created_at: string };

type MenuKey =
  | "overview"
  | "providers"
  | "verifications"
  | "complaints"
  | "reviews"
  | "food-orders"
  | "shipments"
  | "lojas-categorias"
  | "bairros"
  | "stats"
  | "send_notification"
  | "commissions"
  | "settings";

type ProviderFilter = "todos" | "avaliacao" | "ativos" | "rejeitados";
type ReviewFilter = "pendentes" | "aprovadas";

const STATUS_BADGE_KEYS: Record<string, { key: string; className: string }> = {
  aprovado: { key: "admin.active", className: "bg-success-soft text-success-foreground" },
  pendente: { key: "admin.inReview", className: "bg-yellow-100 text-yellow-700" },
  rejeitado: { key: "admin.rejected", className: "bg-problem-soft text-problem-foreground" },
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

const MiniBars = ({ data, color = "bg-primary" }: { data: number[]; color?: string }) => {
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

const StatCard = ({ label, value, icon, onClick }: { label: string; value: number | string; icon: React.ReactNode; onClick: () => void }) => (
  <button
    onClick={onClick}
    className="bg-card border rounded-xl p-4 flex items-center gap-3 text-left hover:border-primary/40 transition-colors"
  >
    <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
      {icon}
    </div>
    <div className="min-w-0">
      <div className="text-2xl font-bold leading-none">{value}</div>
      <div className="text-xs text-muted-foreground mt-1 break-words">{label}</div>
    </div>
  </button>
);

const ORDERS_PER_PAGE = 20;

const useAdminOrders = (shipments: boolean, page: number, enabled: boolean, userId?: string) =>
  useQuery({
    queryKey: ["admin-orders", userId, shipments, page],
    enabled,
    refetchInterval: 30_000,
    queryFn: async () => {
      const query = supabase.from("orders")
        .select("id, order_number, business_id, status, created_at", { count: "exact" });
      const filtered = shipments ? query.is("business_id", null) : query.not("business_id", "is", null);
      const start = (page - 1) * ORDERS_PER_PAGE;
      const { data, count, error } = await filtered
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(start, start + ORDERS_PER_PAGE - 1);
      if (error) throw error;
      return { rows: data, total: count ?? 0 };
    },
  });

const AdminDashboard = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, isAdmin, loading, signOut } = useAuth();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [bairros, setBairros] = useState<Bairro[]>([]);
  const [businessCategories, setBusinessCategories] = useState<Category[]>([]);
  const [beautyCategories, setBeautyCategories] = useState<Category[]>([]);
  const [activity, setActivity] = useState<Record<string, ActivitySeries>>({});
  const [portfolioCount, setPortfolioCount] = useState<Record<string, number>>({});
  const [quality, setQuality] = useState<Record<string, { level: string; score: number }>>({});
  const [loadingData, setLoadingData] = useState(true);
  const [menu, setMenu] = useState<MenuKey>("overview");
  const [orderPage, setOrderPage] = useState(1);
  const selectMenu = (next: MenuKey) => {
    setOrderPage(1);
    setMenu(next);
  };
  const foodOrders = useAdminOrders(false, menu === "food-orders" ? orderPage : 1, !!user && isAdmin, user?.id);
  const shipments = useAdminOrders(true, menu === "shipments" ? orderPage : 1, !!user && isAdmin, user?.id);
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>("avaliacao");
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("pendentes");
  const [deleteTarget, setDeleteTarget] = useState<{ table: "profiles" | "reviews"; id: string; entity: string } | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Provider | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [bairroToDelete, setBairroToDelete] = useState<Bairro | null>(null);
  const [bizCategoryToDelete, setBizCategoryToDelete] = useState<Category | null>(null);
  const [belezaCategoryToDelete, setBelezaCategoryToDelete] = useState<Category | null>(null);
  const [notifTitle, setNotifTitle] = useState("");
  const [notifBody, setNotifBody] = useState("");
  const [notifGroups, setNotifGroups] = useState<string[]>([]);
  const [notifConfirm, setNotifConfirm] = useState(false);
  const [notifHistoryError, setNotifHistoryError] = useState(false);
  const [notifSending, setNotifSending] = useState(false);
  const [adminNotifications, setAdminNotifications] = useState<AdminNotification[]>([]);
  const { data: allCommissions = [] } = useAllCommissions();
  const { data: allCommissionPayments = [] } = useAllCommissionPayments();
  const validateCommission = useValidateCommissionPayment();
  const { data: platformSettings } = usePlatformSettings();
  const updatePlatformSetting = useUpdatePlatformSetting();
  const [commProofPreview, setCommProofPreview] = useState<string | null>(null);
  const [editCommRate, setEditCommRate] = useState("");
  const [editPlatformCode, setEditPlatformCode] = useState("");
  const [editPlatformNumber, setEditPlatformNumber] = useState("");
  const [commSettingsLoaded, setCommSettingsLoaded] = useState(false);
  const [commPaymentToReject, setCommPaymentToReject] = useState<string | null>(null);
  const [commRejectReason, setCommRejectReason] = useState("");

  useEffect(() => {
    if (loading) return;
    if (!user || !isAdmin) return navigate("/login", { replace: true });
    loadAll();
  }, [user, isAdmin, loading, navigate]);

  const loadAll = async () => {
    setLoadingData(true);
    const [
      { data: p },
      { data: rv },
      { data: b },
      { data: st },
      { data: cp },
      { data: act },
      { data: pf },
      { data: ql },
      { data: bc },
      { data: bl },
      { data: an, error: historyError },
    ] = await Promise.all([
      supabase.from("profiles").select("id, name, category, phone, location, price_type, starting_price, photo_url, profile_type, is_verified, verification_status").order("name"),
      supabase.from("reviews").select("id, provider_id, reviewer_name, rating, comment, created_at, status").order("created_at", { ascending: false }),
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
    // As colunas de KYC (documento, selfie, motivo) deixaram de ser legíveis
    // directamente: qualquer conta autenticada lia os documentos de identidade
    // de toda a gente. Vêm agora por RPC de admin e juntam-se aqui.
    const kycMap: Record<string, { verification_doc_url: string | null; verification_selfie_url: string | null; verification_reason: string | null }> = {};
    {
      const { data: kyc } = await (
        supabase.rpc as unknown as (fn: string) => Promise<{ data: unknown; error: unknown }>
      )("admin_list_verifications");
      (((kyc as Array<{ profile_id: string; verification_doc_url: string | null; verification_selfie_url: string | null; verification_reason: string | null }>) ?? [])).forEach((row) => {
        kycMap[row.profile_id] = {
          verification_doc_url: row.verification_doc_url,
          verification_selfie_url: row.verification_selfie_url,
          verification_reason: row.verification_reason,
        };
      });
    }
    setProviders(((p ?? []) as Provider[]).map((prov) => ({
      ...prov,
      ...(kycMap[prov.id] ?? { verification_doc_url: null, verification_selfie_url: null, verification_reason: null }),
      stats: statsMap[prov.id] ?? { profile_views: 0, whatsapp_clicks: 0, call_clicks: 0 },
    })));
    setReviews((rv ?? []) as Review[]);
    setComplaints((cp ?? []) as Complaint[]);
    setBairros((b ?? []) as Bairro[]);
    setBusinessCategories((bc ?? []) as Category[]);
    setBeautyCategories((bl ?? []) as Category[]);
    setNotifHistoryError(!!historyError);
    if (!historyError) setAdminNotifications((an ?? []) as AdminNotification[]);
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
      .on("postgres_changes", { event: "*", schema: "public", table: "quality_levels" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "portfolio_images" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "business_categories" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "beauty_categories" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "bairros" }, () => loadAll())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, isAdmin, loading]);

  useEffect(() => {
    if (platformSettings && !commSettingsLoaded) {
      setEditCommRate(platformSettings.commission_rate ?? "5");
      setEditPlatformCode(platformSettings.platform_merchant_code ?? "");
      setEditPlatformNumber(platformSettings.platform_payment_number ?? "");
      setCommSettingsLoaded(true);
    }
  }, [platformSettings, commSettingsLoaded]);

  const savePlatformSettings = async () => {
    try {
      await Promise.all([
        updatePlatformSetting.mutateAsync({ key: "commission_rate", value: editCommRate }),
        updatePlatformSetting.mutateAsync({ key: "platform_merchant_code", value: editPlatformCode }),
        updatePlatformSetting.mutateAsync({ key: "platform_payment_number", value: editPlatformNumber }),
      ]);
      toast.success(t("commission.settingsSaved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const pendingCommPayments = allCommissionPayments.filter((p) => p.status === "pendente");

  const remove = async (table: "profiles" | "reviews", id: string) => {
    const { error } = table === "profiles"
      ? await supabase.rpc("admin_delete_user", { p_profile_id: id })
      : await supabase.from(table).delete().eq("id", id);
    if (error) {
      const hasFleetLedger = table === "profiles" &&
        error.code === "23503" &&
        error.message.includes("ledger_entries_fleet_id_fkey");

      toast.error(hasFleetLedger ? t("admin.deleteBlockedByFleetLedger") : error.message);
      return;
    }
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
    if (notifSending || !notifTitle.trim() || !notifBody.trim() || !notifGroups.length) return;

    setNotifSending(true);
    try {
      const { data, error } = await supabase.rpc("send_bulk_notification", {
        p_title: notifTitle.trim(),
        p_body: notifBody.trim(),
        p_target_groups: notifGroups,
      });

      if (error) throw error;
      setNotifConfirm(false);

      if (!data) {
        toast.info(t("admin.notifNoRecipients"));
        return;
      }

      toast.success(t("admin.notifSent", { count: data }));
      setNotifTitle("");
      setNotifBody("");
      setNotifGroups([]);
      void loadAll();
    } catch {
      setNotifConfirm(false);
      toast.error(t("admin.notifSendError"));
    } finally {
      setNotifSending(false);
    }
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

  const restaurants = useMemo(() => providers.filter((p) => p.profile_type === "business"), [providers]);

  const filteredProviders = useMemo(() => {
    if (providerFilter === "avaliacao") return restaurants.filter((p) => p.verification_status === "pendente");
    if (providerFilter === "ativos") return restaurants.filter((p) => p.is_verified || p.verification_status === "aprovado");
    if (providerFilter === "rejeitados") return restaurants.filter((p) => p.verification_status === "rejeitado");
    return restaurants;
  }, [restaurants, providerFilter]);

  const filteredReviews = useMemo(() => (reviewFilter === "pendentes" ? pendingReviews : approvedReviews), [reviewFilter, pendingReviews, approvedReviews]);

  const avgRating = useMemo(() => {
    if (!approvedReviews.length) return 0;
    return Math.round((approvedReviews.reduce((s, r) => s + r.rating, 0) / approvedReviews.length) * 10) / 10;
  }, [approvedReviews]);

  const topProviders = useMemo(
    () => [...restaurants].sort((a, b) => (b.stats?.profile_views ?? 0) - (a.stats?.profile_views ?? 0)).slice(0, 5),
    [restaurants]
  );

  const statusBadge = (p: Provider) => {
    const key = p.verification_status || (p.is_verified ? "aprovado" : "none");
    const s = STATUS_BADGE_KEYS[key] ?? STATUS_BADGE_KEYS.none;
    return <Badge className={s.className}>{t(s.key)}</Badge>;
  };

  const qualityLabel = (p: Provider) => {
    const q = quality[p.id];
    if (!q) return { label: "—", className: "text-muted-foreground" };
    const map: Record<string, string> = { alta: "text-success", media: "text-pending", baixa: "text-problem" };
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
                  <MiniBars data={series.vista} color="bg-primary" />
                </div>
                <div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" /> {t("admin.whatsapp")}</span>
                    <span className="font-semibold">{p.stats?.whatsapp_clicks ?? 0}</span>
                  </div>
                  <MiniBars data={series.whatsapp} color="bg-success" />
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
                  <p className="text-xs text-problem-foreground bg-problem-soft rounded-lg p-2">{t("admin.reason", { reason: p.verification_reason })}</p>
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
                  <Button size="sm" onClick={() => approveVerification(p)} className="gap-1 bg-success hover:bg-success/90 text-white">
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
    { key: "food-orders", label: t("admin.foodOrders"), icon: <ClipboardList className="h-4 w-4" /> },
    { key: "shipments", label: t("admin.shipments"), icon: <Send className="h-4 w-4" /> },
    { key: "providers", label: t("admin.restaurants"), icon: <Store className="h-4 w-4" /> },
    { key: "verifications", label: t("admin.verifications"), icon: <ShieldCheck className="h-4 w-4" />, count: pendingVerifications.length },
    { key: "complaints", label: t("admin.complaints"), icon: <ShieldAlert className="h-4 w-4" />, count: pendingComplaints.length },
    { key: "reviews", label: t("admin.reviews"), icon: <Star className="h-4 w-4" />, count: pendingReviews.length },
    { key: "lojas-categorias", label: t("admin.shopCategories"), icon: <Store className="h-4 w-4" /> },
    { key: "bairros", label: t("admin.neighborhoods"), icon: <MapPin className="h-4 w-4" /> },
    { key: "stats", label: t("admin.statistics"), icon: <BarChart3 className="h-4 w-4" /> },
    { key: "send_notification", label: t("admin.sendNotification"), icon: <Bell className="h-4 w-4" /> },
    { key: "commissions", label: t("admin.commissions"), icon: <Coins className="h-4 w-4" />, count: pendingCommPayments.length },
    { key: "settings", label: t("admin.settings"), icon: <Settings className="h-4 w-4" /> },
  ];

  const renderOrders = (query: ReturnType<typeof useAdminOrders>, overview: boolean) => {
    if (query.isError) return <LoadError onRetry={() => void query.refetch()} />;
    if (!query.data) return <p role="status" className="py-4 text-sm text-muted-foreground">{t("admin.loading")}</p>;

    const { rows, total } = query.data;
    const visibleOrders = overview ? rows.slice(0, 5) : rows;
    return (
      <>
        {visibleOrders.length === 0 && <p className="py-4 text-sm text-muted-foreground">{t("orderManagement.noOrders")}</p>}
        <ul className="divide-y">
          {visibleOrders.map((order) => (
            <li key={order.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{order.order_number == null ? order.id.slice(0, 8) : `#${order.order_number}`}</p>
                <p className="text-xs text-muted-foreground">
                  {order.business_id && <>{restaurants.find((restaurant) => restaurant.id === order.business_id)?.name ?? t("admin.shop")} · </>}
                  {new Date(order.created_at).toLocaleDateString(i18n.language === "kri" ? "pt" : i18n.language)}
                </p>
              </div>
              <Badge variant="secondary">{t(`orderStatus.${order.status.replace(/\./g, "_")}`, order.status)}</Badge>
            </li>
          ))}
        </ul>
        {!overview && (
          <Pagination page={orderPage} pageCount={Math.max(orderPage, Math.ceil(total / ORDERS_PER_PAGE))}
            onPageChange={setOrderPage} total={total} />
        )}
      </>
    );
  };

  const navList = (compact = false) => (
    <nav className={compact ? "flex md:hidden gap-1 overflow-x-auto px-4 py-2" : "flex flex-col gap-1"}>
      {menuItems.map((item) => (
        <button
          key={item.key}
          onClick={() => selectMenu(item.key)}
          aria-current={menu === item.key ? "page" : undefined}
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
            <span className={"text-xs rounded-full px-1.5 py-0.5 min-w-5 text-center " + (menu === item.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
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
          <img src={logo} alt="iTudoo" className="h-8 w-auto" />
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
            {/* /inicio e nao "/": a raiz devolve contas de trabalho ao seu
                painel, e um admin que tambem seja motorista era atirado de
                volta para /painel-motorista sem forma de sair. */}
            <Link to="/inicio" className="flex items-center gap-2">
              <img src={logo} alt="iTudoo" className="h-7 w-auto" />
            </Link>
            <div className="flex items-center gap-2">
              <Link to="/inicio">
                <Button variant="outline" size="sm" className="gap-1">
                  <ArrowLeft className="h-4 w-4" /> {t("common.viewSite")}
                </Button>
              </Link>
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
            <Link to="/inicio" className="hover:text-foreground inline-flex items-center gap-1">
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
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <StatCard label={t("admin.foodOrders")} value={foodOrders.data?.total ?? "—"} icon={<ClipboardList className="h-5 w-5" />} onClick={() => selectMenu("food-orders")} />
                <StatCard label={t("admin.shipments")} value={shipments.data?.total ?? "—"} icon={<Send className="h-5 w-5" />} onClick={() => selectMenu("shipments")} />
                <StatCard label={t("admin.restaurants")} value={restaurants.length} icon={<Store className="h-5 w-5" />} onClick={() => setMenu("providers")} />
                <StatCard label={t("admin.pendingVerifications")} value={pendingVerifications.length} icon={<ShieldCheck className="h-5 w-5" />} onClick={() => setMenu("verifications")} />
                <StatCard label={t("admin.pendingReviews")} value={pendingReviews.length} icon={<Star className="h-5 w-5" />} onClick={() => setMenu("reviews")} />
                <StatCard label={t("admin.pendingComplaints")} value={pendingComplaints.length} icon={<ShieldAlert className="h-5 w-5" />} onClick={() => setMenu("complaints")} />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {([
                  ["food-orders", t("admin.foodOrders"), foodOrders],
                  ["shipments", t("admin.shipments"), shipments],
                ] as const).map(([key, label, query]) => (
                  <Card key={key}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-2">
                        <h2 className="font-semibold text-sm">{label}</h2>
                        <Button type="button" variant="ghost" size="icon" aria-label={label} onClick={() => selectMenu(key)}>
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                      {renderOrders(query, true)}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {menu === "providers" && (
            <div className="flex flex-col gap-4">
              <h1 className="text-2xl font-bold">{t("admin.restaurants")}</h1>
              <Tabs value={providerFilter} onValueChange={(v) => setProviderFilter(v as ProviderFilter)}>
                <div className="overflow-x-auto -mx-4 px-4 mb-4">
                  <TabsList className="inline-flex w-max gap-1">
                    <TabsTrigger value="avaliacao">{t("admin.inReviewCount", { count: restaurants.filter((p) => p.verification_status === "pendente").length })}</TabsTrigger>
                    <TabsTrigger value="ativos">{t("admin.activeCount", { count: restaurants.filter((p) => p.is_verified || p.verification_status === "aprovado").length })}</TabsTrigger>
                    <TabsTrigger value="rejeitados">{t("admin.rejectedCount", { count: restaurants.filter((p) => p.verification_status === "rejeitado").length })}</TabsTrigger>
                    <TabsTrigger value="todos">{t("admin.allCount", { count: restaurants.length })}</TabsTrigger>
                  </TabsList>
                </div>
                <TabsContent value={providerFilter} className="flex flex-col gap-3">
                  {filteredProviders.map(providerCard)}
                  {!filteredProviders.length && <p className="text-sm text-muted-foreground text-center py-6">{t("admin.noRestaurants")}</p>}
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
                        <Button size="sm" onClick={() => approveVerification(p)} className="gap-1 bg-success hover:bg-success/90 text-white">
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
                  <Card key={c.id} className="border-problem/40">
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
                        <Button size="sm" onClick={() => setComplaintStatus(c, "validada")} className="gap-1 bg-success hover:bg-success/90 text-white">
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
                      <Card key={c.id} className={c.status === "validada" ? "border-success/40" : "border-muted"}>
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
                            <Button size="sm" onClick={() => approveReview(r.id)} className="gap-1 bg-success hover:bg-success/90 text-white">
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

          {(menu === "food-orders" || menu === "shipments") && (
            <div className="space-y-4">
              <h1 className="text-2xl font-bold">{menu === "food-orders" ? t("admin.foodOrders") : t("admin.shipments")}</h1>
              {renderOrders(menu === "food-orders" ? foodOrders : shipments, false)}
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
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <StatCard label={t("admin.restaurants")} value={restaurants.length} icon={<Store className="h-5 w-5" />} onClick={() => setMenu("providers")} />
                <StatCard label={t("admin.foodOrders")} value={foodOrders.data?.total ?? "—"} icon={<ClipboardList className="h-5 w-5" />} onClick={() => selectMenu("food-orders")} />
                <StatCard label={t("admin.shipments")} value={shipments.data?.total ?? "—"} icon={<Send className="h-5 w-5" />} onClick={() => selectMenu("shipments")} />
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
                    <Label htmlFor="notification-title">{t("admin.notifTitle")}</Label>
                    <input
                      id="notification-title"
                      type="text"
                      value={notifTitle}
                      onChange={(e) => setNotifTitle(e.target.value)}
                      placeholder={t("admin.notifTitlePlaceholder")}
                      className="w-full border rounded-lg px-3 py-2 text-sm bg-background"
                      maxLength={120}
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label htmlFor="notification-message">{t("admin.notifMessage")}</Label>
                    <textarea
                      id="notification-message"
                      value={notifBody}
                      onChange={(e) => setNotifBody(e.target.value)}
                      placeholder={t("admin.notifMessagePlaceholder")}
                      className="w-full border rounded-lg px-3 py-2 text-sm bg-background min-h-[80px] resize-none"
                      maxLength={500}
                    />
                  </div>

                  <fieldset disabled={notifSending} className="space-y-2">
                    <legend className="text-sm font-medium">{t("admin.notifTarget")}</legend>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {Object.entries(NOTIFICATION_AUDIENCES).map(([value, label]) => (
                        <label key={value} className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm">
                          <input
                            type="checkbox"
                            checked={notifGroups.includes(value)}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setNotifGroups((prev) => checked ? [...prev, value] : prev.filter((group) => group !== value));
                            }}
                          />
                          {t(label)}
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <Button
                    onClick={() => setNotifConfirm(true)}
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
                {notifHistoryError ? (
                  <LoadError onRetry={() => void loadAll()} />
                ) : adminNotifications.length === 0 ? (
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
                                <span>{n.target_groups.map((group) =>
                                  NOTIFICATION_AUDIENCE_LABELS[group] ? t(NOTIFICATION_AUDIENCE_LABELS[group]) : group
                                ).join(", ")}</span>
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

          <ConfirmDialog
            open={notifConfirm}
            onOpenChange={setNotifConfirm}
            title={t("admin.notifConfirmTitle")}
            description={t("admin.notifConfirmDescription", {
              title: notifTitle.trim(),
              groups: notifGroups.map((group) => t(NOTIFICATION_AUDIENCE_LABELS[group])).join(", "),
            })}
            confirmLabel={t("admin.notifSend")}
            busy={notifSending}
            onConfirm={() => void sendBulkNotification()}
          />

          {menu === "commissions" && (
            <div className="flex flex-col gap-4">
              <h1 className="text-2xl font-bold">{t("admin.commissions")}</h1>

              {/* Platform commission settings */}
              <Card>
                <CardContent className="p-4 space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("commission.settings")}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">{t("commission.rate")} (%)</Label>
                      <Input type="number" min="0" max="100" step="0.5" value={editCommRate} onChange={(e) => setEditCommRate(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t("commission.platformCode")}</Label>
                      <Input placeholder="#144#32*..." value={editPlatformCode} onChange={(e) => setEditPlatformCode(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t("commission.platformNumber")}</Label>
                      <Input placeholder="955 123 456" value={editPlatformNumber} onChange={(e) => setEditPlatformNumber(e.target.value)} />
                    </div>
                  </div>
                  <Button size="sm" onClick={savePlatformSettings} disabled={updatePlatformSetting.isPending}>
                    {t("common.save")}
                  </Button>
                </CardContent>
              </Card>

              {/* Businesses with commissions */}
              <Card>
                <CardContent className="p-4 space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("commission.businessList")}</p>
                  {allCommissions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("commission.noData")}</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-xs text-muted-foreground">
                            {/* §26: a plataforma tem DUAS fontes de comissão,
                                restaurantes e frotas, com contas separadas. A
                                coluna diz de qual se trata. */}
                            <th className="text-left py-2 px-1">{t("commission.account", "Conta")}</th>
                            <th className="text-right py-2 px-1">{t("commission.totalSales")}</th>
                            <th className="text-right py-2 px-1">{t("commission.due")}</th>
                            <th className="text-right py-2 px-1">{t("commission.paid")}</th>
                            <th className="text-right py-2 px-1">{t("commission.balance")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {allCommissions.map((c) => (
                            <tr key={`${c.account_kind}:${c.account_id}`} className="border-b">
                              <td className="py-2 px-1 font-medium">
                                {c.account_name}
                                <span className="ml-1 text-[10px] text-muted-foreground uppercase">
                                  {c.account_kind === "fleet" ? t("commission.fleet", "frota") : t("commission.restaurant")}
                                </span>
                              </td>
                              <td className="py-2 px-1 text-right">{formatCFA(c.total_base)}</td>
                              <td className="py-2 px-1 text-right">{formatCFA(c.commission_due)}</td>
                              <td className="py-2 px-1 text-right text-success">{formatCFA(c.commission_paid)}</td>
                              <td className={"py-2 px-1 text-right font-bold " + (c.commission_balance > 0 ? "text-pending" : "text-success")}>
                                {formatCFA(c.commission_balance)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Pending commission payments */}
              <Card>
                <CardContent className="p-4 space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {t("commission.pendingPayments")} ({pendingCommPayments.length})
                  </p>
                  {pendingCommPayments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("commission.noPending")}</p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {pendingCommPayments.map((cp) => (
                        <div key={cp.id} className="rounded-lg border p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-sm">{(cp as unknown as Record<string, unknown>).business_name as string}</span>
                            <span className="text-sm font-bold">{formatCFA(cp.amount)}</span>
                          </div>
                          <span className="text-xs text-muted-foreground">{new Date(cp.created_at).toLocaleString()}</span>
                          {cp.proof_url && (
                            <ImagemPrivada
                              bucket={BUCKET_PRIVADO.comprovativosComissao}
                              refFicheiro={cp.proof_url}
                              alt="Comprovativo"
                              className="w-full max-h-40 object-contain rounded-md border cursor-pointer hover:opacity-90"
                              onAbrir={setCommProofPreview}
                            />
                          )}
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="flex-1 gap-1 bg-success hover:bg-success/90 text-white"
                              onClick={() => validateCommission.mutate({ id: cp.id, status: "validado" })}
                              disabled={validateCommission.isPending}
                            >
                              <Check className="h-3.5 w-3.5" /> {t("commission.validate")}
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="flex-1 gap-1"
                              onClick={() => setCommPaymentToReject(cp.id)}
                              disabled={validateCommission.isPending}
                            >
                              <X className="h-3.5 w-3.5" /> {t("commission.reject")}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Commission proof preview */}
          <Dialog open={!!commProofPreview} onOpenChange={(o) => { if (!o) setCommProofPreview(null); }}>
            <DialogContent className="p-0 border-0 bg-transparent max-w-[90vw] w-auto shadow-none">
              {commProofPreview && (
                <img src={commProofPreview} alt="Comprovativo" className="max-h-[80vh] max-w-full rounded-lg object-contain mx-auto" />
              )}
            </DialogContent>
          </Dialog>

          {/* Commission rejection reason dialog */}
          <ConfirmDialog
            open={commPaymentToReject !== null}
            onOpenChange={(o) => { if (!o) { setCommPaymentToReject(null); setCommRejectReason(""); } }}
            title={t("commission.rejectPayment")}
            description={t("commission.rejectReason")}
            confirmLabel={t("commission.reject")}
            destructive
            input={{
              label: t("commission.rejectionReason"),
              placeholder: t("commission.rejectionPlaceholder"),
              value: commRejectReason,
              onChange: setCommRejectReason,
            }}
            onConfirm={() => {
              if (!commRejectReason.trim()) {
                toast.error(t("commission.reasonRequired"));
                return;
              }
              if (commPaymentToReject) {
                validateCommission.mutate({ id: commPaymentToReject, status: "rejeitado", reason: commRejectReason });
                setCommPaymentToReject(null);
                setCommRejectReason("");
              }
            }}
          />

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
                    <span className="font-medium">{t("admin.itudoo")}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{t("admin.shopCategories")}</span>
                    <span className="font-medium">{businessCategories.length}</span>
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
