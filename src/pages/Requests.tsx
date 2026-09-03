import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MapPin, MessageCircle, Plus, Tag, Clock, ChevronDown, ChevronUp, Users, CheckCircle2, XCircle, Star, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Pagination } from "@/components/Pagination";
import { useAuth } from "@/hooks/useAuth";
import { useMyProvider } from "@/hooks/useMyProvider";
import { useCategories } from "@/hooks/useProviders";
import { useBairros } from "@/hooks/useBairros";
import { useRequireClientAuth } from "@/hooks/useRequireClientAuth";
import { ClientSignupDialog } from "@/components/ClientSignupDialog";
import { BAIRROS_FILTER } from "@/lib/locations";
import { formatCFA } from "@/lib/format";
import { getPageCount, paginateArray } from "@/lib/pagination";
import { getCategoryName, translateCategoryName } from "@/lib/categoryI18n";
import {
  useRequests, useCreateRequest,
  useBidsForRequest, useBidOnRequest, useUpdateBidStatus, useMyBidOnRequest,
  useMarkRequestCompleted, useSubmitReview,
  type ServiceRequest, type RequestBidWithProvider,
} from "@/hooks/useRequests";
import { StarRating } from "@/components/StarRating";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { supabase } from "@/integrations/supabase/client";

const PAGE_SIZE = 10;

const Requests = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, isClient } = useAuth();
  const { data: providerProfile } = useMyProvider(user?.id ?? null);
  const { data: requests = [], isLoading } = useRequests();
  const { data: categories = [] } = useCategories();
  const { data: bairros = [] } = useBairros();
  const bairroOptions = bairros.length ? bairros : BAIRROS_FILTER.slice(1);
  const create = useCreateRequest();
  const bidOnRequest = useBidOnRequest();
  const updateBid = useUpdateBidStatus();
  const { requireAuth, open: signupOpen, setOpen: setSignupOpen, onSignupSuccess } = useRequireClientAuth();

  // Vincular pedidos anónimos quando o utilizador faz login
  useEffect(() => {
    if (!user) return;
    supabase.rpc("claim_anonymous_requests").then(({ data, error }) => {
      if (error) console.error("[requests] claim error:", error.message);
      else if (data && data > 0) toast.success(t("requests.claimedRequests", { count: data }));
    });
  }, [user]);

  const DEADLINE_OPTIONS = [
    { value: "urgente", label: t("requests.urgent") },
    { value: "hoje", label: t("requests.today") },
    { value: "esta_semana", label: t("requests.thisWeek") },
    { value: "proxima_semana", label: t("requests.nextWeek") },
    { value: "flexivel", label: t("requests.flexible") },
  ];

  const BUDGET_OPTIONS = [
    { value: "fixo", label: t("requests.fixedValue") },
    { value: "negociavel", label: t("requests.negotiable") },
    { value: "combinar", label: t("requests.toCombine") },
  ];

  const [tab, setTab] = useState<"disponiveis" | "publicar" | "meus">("disponiveis");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterLocation, setFilterLocation] = useState("all");
  const [expandedRequest, setExpandedRequest] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const [form, setForm] = useState({
    requester_name: "",
    requester_phone: "",
    category: "",
    location: "",
    description: "",
    deadline: "",
    budget_type: "combinar",
    budget_amount: "",
  });

  const [bidForm, setBidForm] = useState<{ requestId: string; message: string; requesterPhone: string | null; requesterName: string | null; category: string } | null>(null);

  const markCompleted = useMarkRequestCompleted();
  const submitReview = useSubmitReview();
  const [reviewDialog, setReviewDialog] = useState<{ requestId: string; providerId: string; providerName: string } | null>(null);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewName, setReviewName] = useState("");

  // Pré-preencher nome/telefone se logado
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("profiles").select("name, phone").eq("user_id", user.id).maybeSingle();
      if (cancelled) return;
      if (data?.name || data?.phone) {
        setForm((f) => ({
          ...f,
          requester_name: f.requester_name || (data.name ?? ""),
          requester_phone: f.requester_phone || (data.phone ?? ""),
        }));
      } else if (user.email) {
        const emailName = user.email.split("@")[0];
        setForm((f) => ({ ...f, requester_name: f.requester_name || emailName }));
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  const openRequests = requests.filter((r) => r.status === "open");
  const myRequests = user ? requests.filter((r) => r.user_id === user.id) : [];

  const filtered = openRequests.filter((r) => {
    if (filterCategory !== "all" && r.category !== filterCategory) return false;
    if (filterLocation !== "all" && !r.location.toLowerCase().includes(filterLocation.toLowerCase())) return false;
    return true;
  });

  const pageCount = getPageCount(filtered.length, PAGE_SIZE);
  const paginatedRequests = paginateArray(filtered, page, PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [filterCategory, filterLocation]);

  const executePublish = async () => {
    const phone = form.requester_phone.trim();
    if (!user) {
      if (!phone) {
        toast.error(t("requests.phoneRequiredAnon"));
        return;
      }
      const start = new Date(); start.setHours(0,0,0,0);
      const { count } = await supabase.from("service_requests").select("id", { count: "exact", head: true }).eq("requester_phone", phone).is("user_id", null).gte("created_at", start.toISOString());
      if (count !== null && count >= 3) {
        toast.error(t("requests.spamLimitAnon"));
        return;
      }
    } else {
      const start = new Date(); start.setHours(0,0,0,0);
      const { count } = await supabase.from("service_requests").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", start.toISOString());
      if (count !== null && count >= 10) {
        toast.error(t("requests.spamLimitAuth"));
        return;
      }
    }
    try {
      await create.mutateAsync({
        category: form.category,
        description: form.description.trim(),
        location: form.location.trim() || "Bissau",
        requester_name: form.requester_name.trim() || t("requestsExtra.clientFallback"),
        requester_phone: form.requester_phone.trim(),
        user_id: user?.id,
        deadline: form.deadline || null,
        budget_type: form.budget_type,
        budget_amount: form.budget_amount ? Number(form.budget_amount) : null,
      });
      toast.success(t("requests.requestPublished"));
      setForm((f) => ({ ...f, category: "", location: "", description: "", deadline: "", budget_type: "combinar", budget_amount: "" }));
      // manter nome/telefone pré-preenchidos se logado
      setShowAnonWarning(false);
      // sem conta não há "Meus": volta ao feed em vez da tab que pede login
      setTab(user ? "meus" : "disponiveis");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("requestsExtra.tryAgain");
      toast.error(msg);
    }
  };

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.category) return toast.error(t("requests.selectCategory"));
    if (!form.description.trim()) return toast.error(t("requests.describeRequest"));
    requireAuth(() => executePublish());
  };

  const handleBid = async () => {
    if (!bidForm || !providerProfile) return;
    try {
      await bidOnRequest.mutateAsync({
        request_id: bidForm.request_id,
        provider_id: providerProfile.id,
        message: bidForm.message || undefined,
      });
      toast.success(t("requests.applicationSent"));
      // Open WhatsApp to client
      if (bidForm.requesterPhone) {
        const phone = bidForm.requesterPhone.replace(/[^\d+]/g, "");
        const messageSuffix = bidForm.message ? "\n\nMensagem: " + bidForm.message : "";
        const msg = t("requestsExtra.whatsappBidMsg", { name: bidForm.requesterName ?? t("requestsExtra.clientFallback"), providerName: providerProfile.name ?? t("requestsExtra.providerFallback"), category: bidForm.category, message: messageSuffix });
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
      }
      setBidForm(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("requests.alreadyApplied");
      toast.error(msg);
    }
  };

  const handleBidStatus = async (bidId: string, status: "aceite" | "recusado") => {
    try {
      await updateBid.mutateAsync({ id: bidId, status });
      toast.success(status === "aceite" ? t("requests.applicationAccepted") : t("requests.applicationRejected"));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("requestsExtra.error");
      toast.error(msg);
    }
  };

  const handleMarkCompleted = async (requestId: string) => {
    try {
      await markCompleted.mutateAsync(requestId);
      toast.success(t("requests.serviceCompleted"));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("requests.completeError");
      toast.error(msg);
    }
  };

  const handleSubmitReview = async () => {
    if (!reviewDialog || !user) return;
    if (reviewRating < 1) {
      toast.error(t("requests.selectStars"));
      return;
    }
    if (!reviewName.trim()) {
      toast.error(t("requests.enterName"));
      return;
    }
    try {
      await submitReview.mutateAsync({
        provider_id: reviewDialog.providerId,
        request_id: reviewDialog.requestId,
        rating: reviewRating,
        comment: reviewComment.trim() || null,
        reviewer_name: reviewName.trim(),
        user_id: user.id,
      });
      toast.success(t("requests.reviewSent"));
      setReviewDialog(null);
      setReviewRating(0);
      setReviewComment("");
      setReviewName("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("requests.reviewError");
      toast.error(msg);
    }
  };

  return (
    <div className="max-w-lg mx-auto px-4 pt-6">
      <h1 className="text-xl font-bold mb-4">{t("requests.title")}</h1>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="grid grid-cols-3 w-full mb-4">
          <TabsTrigger value="disponiveis" className="whitespace-nowrap">{t("requests.available")}</TabsTrigger>
          <TabsTrigger value="publicar" className="whitespace-nowrap">{t("requests.publish")}</TabsTrigger>
          <TabsTrigger value="meus" className="whitespace-nowrap">{t("requests.mine")}</TabsTrigger>
        </TabsList>

        {/* ─── TAB: Disponíveis (feed) ─── */}
        <TabsContent value="disponiveis">
          <div className="flex flex-col gap-3 mb-3">
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="h-9 text-sm bg-card">
                <SelectValue placeholder={t("requests.allCategories")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("requests.allCategories")}</SelectItem>
                {categories.map((c) => {
                  const cat = c as unknown as string | { id: string; name: string; name_en: string | null; name_fr: string | null };
                  const isStr = typeof cat === "string";
                  const value = isStr ? cat : cat.name;
                  const display = isStr ? cat : getCategoryName(cat, i18n.language);
                  return <SelectItem key={isStr ? cat : cat.id} value={value}>{display}</SelectItem>;
                })}
              </SelectContent>
            </Select>
            <Select value={filterLocation} onValueChange={setFilterLocation}>
              <SelectTrigger className="h-9 text-sm bg-card">
                <SelectValue placeholder={t("requests.allLocations")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("requests.allLocations")}</SelectItem>
                {bairroOptions.map((b) => (
                  <SelectItem key={b} value={b}>{b}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-8">{t("requests.loading")}</p>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-muted-foreground">
                {openRequests.length === 0
                  ? t("requests.noRequests")
                  : t("requests.noFilteredRequests")}
              </p>
              {openRequests.length === 0 && (
                <Button size="sm" className="mt-4 gap-1" onClick={() => setTab("publicar")}>
                  <Plus className="h-4 w-4" /> {t("requests.publishEmptyButton")}
                </Button>
              )}
            </div>
          ) : (
            <>
            <div className="flex flex-col gap-3">
              {paginatedRequests.map((r) => (
                <RequestCard
                  key={r.id}
                  request={r}
                  providerProfile={providerProfile}
                  expanded={expandedRequest === r.id}
                  onToggle={() => setExpandedRequest(expandedRequest === r.id ? null : r.id)}
                  onBid={() => setBidForm({ requestId: r.id, message: "", requesterPhone: r.requester_phone, requesterName: r.requester_name, category: r.category })}
                  bidOnRequest={bidOnRequest}
                />
              ))}
            </div>
            <Pagination page={page} pageCount={pageCount} total={filtered.length} onPageChange={setPage} />
            </>
          )}
        </TabsContent>

        {/* ─── TAB: Publicar ─── */}
        <TabsContent value="publicar">
          <form onSubmit={handlePublish} className="flex flex-col gap-3">
            <Input
              placeholder={t("requests.yourName")}
              value={form.requester_name}
              onChange={(e) => setForm({ ...form, requester_name: e.target.value })}
              maxLength={80}
            />
            <Input
              placeholder={t("requests.phoneWhatsapp")}
              value={form.requester_phone}
              onChange={(e) => setForm({ ...form, requester_phone: e.target.value })}
              maxLength={25}
            />
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
              <SelectTrigger><SelectValue placeholder={t("requests.serviceCategory")} /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => {
                  const cat = c as unknown as string | { id: string; name: string; name_en: string | null; name_fr: string | null };
                  const isStr = typeof cat === "string";
                  const value = isStr ? cat : cat.name;
                  const display = isStr ? cat : getCategoryName(cat, i18n.language);
                  return <SelectItem key={isStr ? cat : cat.id} value={value}>{display}</SelectItem>;
                })}
              </SelectContent>
            </Select>
            <Select value={form.location} onValueChange={(v) => setForm({ ...form, location: v })}>
              <SelectTrigger><SelectValue placeholder={t("requests.locationNeighborhood")} /></SelectTrigger>
              <SelectContent>
                {bairroOptions.map((b) => (
                  <SelectItem key={b} value={b}>{b}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              placeholder={t("requests.describeNeed")}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              maxLength={500}
              rows={4}
            />

            <div className="border-t border-border pt-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t("requests.deadline")}</p>
              <div className="flex flex-wrap gap-2">
                {DEADLINE_OPTIONS.map((opt) => (
                  <Badge
                    key={opt.value}
                    variant={form.deadline === opt.value ? "default" : "outline"}
                    className="cursor-pointer px-3 py-1.5 text-xs"
                    onClick={() => setForm({ ...form, deadline: form.deadline === opt.value ? "" : opt.value })}
                  >
                    {opt.label}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="border-t border-border pt-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t("requests.budget")}</p>
              <div className="flex flex-wrap gap-2 mb-2">
                {BUDGET_OPTIONS.map((opt) => (
                  <Badge
                    key={opt.value}
                    variant={form.budget_type === opt.value ? "default" : "outline"}
                    className="cursor-pointer px-3 py-1.5 text-xs"
                    onClick={() => setForm({ ...form, budget_type: opt.value, budget_amount: opt.value === "fixo" ? form.budget_amount : "" })}
                  >
                    {opt.label}
                  </Badge>
                ))}
              </div>
              {form.budget_type === "fixo" && (
                <Input
                  type="number"
                  min="0"
                  placeholder={t("requests.cfaPlaceholder")}
                  value={form.budget_amount}
                  onChange={(e) => setForm({ ...form, budget_amount: e.target.value })}
                />
              )}
            </div>

            <Button type="submit" disabled={create.isPending} className="w-full mt-2">
              {create.isPending ? t("requests.publishing") : t("requests.publishRequest")}
            </Button>
          </form>
        </TabsContent>

        {/* ─── TAB: Os Meus (pedidos que publiquei) ─── */}
        <TabsContent value="meus">
          {!user ? (
            <div className="text-center py-12 space-y-4">
              <div className="mx-auto h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                <ClipboardList className="h-8 w-8 text-primary" />
              </div>
              <div>
                <p className="font-semibold">{t("requests.clientSignupTitle")}</p>
                <p className="text-sm text-muted-foreground mt-1">{t("requests.clientSignupDesc")}</p>
              </div>
              <div className="flex flex-col gap-2 max-w-xs mx-auto">
                <Button onClick={() => navigate("/login?mode=cliente")} className="w-full h-11">
                  {t("auth.continueWithGoogle")}
                </Button>
                <Button variant="outline" onClick={() => navigate("/login?mode=cliente")} className="w-full h-11">
                  {t("auth.continueWithEmail")}
                </Button>
              </div>
            </div>
          ) : myRequests.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              {t("requests.noPublished")}
              <div className="mt-4">
                <Button size="sm" onClick={() => setTab("publicar")}>
                  <Plus className="h-4 w-4 mr-1" /> {t("requests.publishRequestAction")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {myRequests.map((r) => (
                <MyRequestCard
                  key={r.id}
                  request={r}
                  expanded={expandedRequest === r.id}
                  onToggle={() => setExpandedRequest(expandedRequest === r.id ? null : r.id)}
                  onBidStatus={handleBidStatus}
                  onMarkCompleted={handleMarkCompleted}
                  onReview={(requestId, providerId, providerName) =>
                    setReviewDialog({ requestId, providerId, providerName })
                  }
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ─── Dialog: Candidatar-se ─── */}
      <Dialog open={!!bidForm} onOpenChange={(open) => { if (!open) setBidForm(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("requests.applyTitle")}</DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder={t("requests.applyMessage")}
            value={bidForm?.message ?? ""}
            onChange={(e) => setBidForm(bidForm ? { ...bidForm, message: e.target.value } : null)}
            rows={3}
          />
          <DialogFooter>
            <Button onClick={handleBid} disabled={bidOnRequest.isPending} className="w-full">
              {bidOnRequest.isPending ? t("requests.sending") : t("requests.sendApplication")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Dialog: Avaliar prestador ─── */}
      <Dialog open={!!reviewDialog} onOpenChange={(open) => { if (!open) setReviewDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("requests.rateProvider", { name: reviewDialog?.providerName ?? "" })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("requests.rateHint")}</p>
            <div className="flex items-center gap-2">
              <StarRating rating={reviewRating} onChange={setReviewRating} size="md" />
            </div>
            <Input
              placeholder={t("requests.yourNameLabel")}
              value={reviewName}
              onChange={(e) => setReviewName(e.target.value)}
            />
            <Textarea
              placeholder={t("requests.commentOptional")}
              value={reviewComment}
              onChange={(e) => setReviewComment(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button onClick={handleSubmitReview} disabled={submitReview.isPending} className="w-full">
              {submitReview.isPending ? t("requests.sending") : t("requests.sendReview")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Dialog: Criar conta de cliente ─── */}
      <ClientSignupDialog open={signupOpen} onOpenChange={setSignupOpen} onSuccess={onSignupSuccess} />
    </div>
  );
};

/* ─── Card de pedido disponível (feed para prestadores) ─── */
function RequestCard({
  request: r,
  providerProfile,
  expanded,
  onToggle,
  onBid,
  bidOnRequest,
}: {
  request: ServiceRequest;
  providerProfile: { id: string; name?: string } | null;
  expanded: boolean;
  onToggle: () => void;
  onBid: () => void;
  bidOnRequest: { isPending: boolean };
}) {
  const { t } = useTranslation();
  const { data: cats = [] } = useCategories();
  const displayCat = translateCategoryName(r.category, cats as { id: string; name: string; name_en: string | null; name_fr: string | null }[], i18n.language);
  const { data: myBid } = useMyBidOnRequest(r.id, providerProfile?.id ?? null);
  const deadlineMap: Record<string, string> = {
    urgente: t("requests.urgent"),
    hoje: t("requests.today"),
    esta_semana: t("requests.thisWeek"),
    proxima_semana: t("requests.nextWeek"),
    flexivel: t("requests.flexible"),
  };
  const deadlineLabel = r.deadline ? deadlineMap[r.deadline] : undefined;
  const budgetLabelMap: Record<string, string> = {
    fixo: t("requests.fixedValue"),
    negociavel: t("requests.negotiable"),
    combinar: t("requests.toCombine"),
  };

  return (
    <Card className="border-border/60">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-sm">{r.requester_name ?? t("admin.client")}</h3>
            <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><Tag className="h-3 w-3" />{displayCat}</span>
              <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{r.location}</span>
              {deadlineLabel && (
                <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{deadlineLabel}</span>
              )}
            </div>
          </div>
          <Badge variant={r.budget_type === "fixo" ? "default" : "secondary"} className="text-[10px] shrink-0">
            {r.budget_type === "fixo" && r.budget_amount
              ? formatCFA(r.budget_amount)
              : budgetLabelMap[r.budget_type] ?? r.budget_type}
          </Badge>
        </div>

        <p className="text-sm text-foreground/90 mb-3 whitespace-pre-wrap">{r.description}</p>

        <div className="flex items-center gap-2 text-[11px] text-muted-foreground mb-3">
          <span>{t("requests.published", { date: new Date(r.created_at).toLocaleDateString(i18n.language) })}</span>
        </div>

        {providerProfile ? (
          myBid ? (
            <div className={`flex items-center gap-2 text-sm font-medium py-2 px-3 rounded-lg ${
              myBid.status === "aceite"
                ? "bg-green-500/10 text-green-600"
                : myBid.status === "recusado"
                  ? "bg-destructive/10 text-destructive"
                  : "bg-muted text-muted-foreground"
            }`}>
              {myBid.status === "aceite" ? <CheckCircle2 className="h-4 w-4" /> : myBid.status === "recusado" ? <XCircle className="h-4 w-4" /> : null}
              {myBid.status === "pendente" ? t("requests.applicationPending") : myBid.status === "aceite" ? t("requests.applicationAcceptedLabel") : t("requests.applicationRejectedLabel")}
              {myBid.status === "aceite" && r.requester_phone && (
                <a
                  href={`https://wa.me/${r.requester_phone.replace(/[^\d+]/g, "")}?text=${encodeURIComponent(t("requestsExtra.whatsappAcceptMsg", { name: r.requester_name ?? t("requestsExtra.clientFallback"), providerName: providerProfile.name ?? t("requestsExtra.providerFallback"), category: r.category }))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button size="sm" className="ml-2 bg-[#25D366] hover:bg-[#1ebe57] text-white gap-1 h-7 text-[11px]">
                    <MessageCircle className="h-3 w-3" /> {t("requests.whatsapp")}
                  </Button>
                </a>
              )}
            </div>
          ) : (
            <div className="flex gap-2">
              <Button
                onClick={onBid}
                disabled={bidOnRequest.isPending}
                className="flex-1"
                variant="outline"
              >
                {t("requests.interested")}
              </Button>
              {r.requester_phone && (
                <a
                  href={`https://wa.me/${r.requester_phone.replace(/[^\d+]/g, "")}?text=${encodeURIComponent(t("requestsExtra.whatsappBidShort", { name: r.requester_name ?? t("requestsExtra.clientFallback"), category: r.category }))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button className="bg-[#25D366] hover:bg-[#1ebe57] text-white gap-1">
                    <MessageCircle className="h-4 w-4" /> {t("requests.whatsapp")}
                  </Button>
                </a>
              )}
            </div>
          )
        ) : (
          <Link to="/login" className="block">
            <Button variant="outline" className="w-full" size="sm">{t("requests.loginToApply")}</Button>
          </Link>
        )}

        <button onClick={onToggle} className="flex items-center gap-1 text-xs text-muted-foreground mt-3 hover:text-foreground transition-colors">
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? t("requests.collapse") : t("requests.moreDetails")}
        </button>
        {expanded && (
          <div className="mt-2 text-xs text-muted-foreground space-y-1">
            <p><span className="font-medium text-foreground">{t("requests.categoryLabel")}</span> {displayCat}</p>
            <p><span className="font-medium text-foreground">{t("requests.locationLabel")}</span> {r.location}</p>
            {deadlineLabel && <p><span className="font-medium text-foreground">{t("requests.deadlineLabel")}</span> {deadlineLabel}</p>}
            <p><span className="font-medium text-foreground">{t("requests.budgetLabel")}</span>{" "}
              {r.budget_type === "fixo" && r.budget_amount ? formatCFA(r.budget_amount) : budgetLabelMap[r.budget_type]}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ─── Card de pedido meu (cliente vê quem se candidatou) ─── */
function MyRequestCard({
  request: r,
  expanded,
  onToggle,
  onBidStatus,
  onMarkCompleted,
  onReview,
}: {
  request: ServiceRequest;
  expanded: boolean;
  onToggle: () => void;
  onBidStatus: (bidId: string, status: "aceite" | "recusado") => void;
  onMarkCompleted: (requestId: string) => void;
  onReview: (requestId: string, providerId: string, providerName: string) => void;
}) {
  const { t } = useTranslation();
  const { data: cats2 = [] } = useCategories();
  const displayCatMy = translateCategoryName(r.category, cats2 as { id: string; name: string; name_en: string | null; name_fr: string | null }[], i18n.language);
  const { data: bids = [], isLoading: loadingBids } = useBidsForRequest(r.id);
  const deadlineMap: Record<string, string> = {
    urgente: t("requests.urgent"),
    hoje: t("requests.today"),
    esta_semana: t("requests.thisWeek"),
    proxima_semana: t("requests.nextWeek"),
    flexivel: t("requests.flexible"),
  };
  const deadlineLabel = r.deadline ? deadlineMap[r.deadline] : undefined;
  const acceptedBid = bids.find((b) => b.status === "aceite");
  const isConcluded = r.status === "concluido";
  const isClosed = r.status === "closed";

  return (
    <Card className="border-border/60">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-sm">{displayCatMy}</h3>
            <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{r.location}</span>
              {deadlineLabel && (
                <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{deadlineLabel}</span>
              )}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            {isConcluded && (
              <Badge variant="default" className="text-[10px] bg-green-600">{t("requests.completed")}</Badge>
            )}
            {isClosed && !isConcluded && (
              <Badge variant="destructive" className="text-[10px]">{t("requests.closed")}</Badge>
            )}
            <Badge variant="secondary" className="text-[10px]">
              {t("requests.applications", { count: bids.length })}
            </Badge>
          </div>
        </div>

        <p className="text-sm text-foreground/90 mb-2 whitespace-pre-wrap">{r.description}</p>

        <button onClick={onToggle} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? t("requests.collapse") : t("requests.applications", { count: bids.length })}
        </button>

        {expanded && (
          <div className="mt-3 border-t border-border pt-3">
            {loadingBids ? (
              <p className="text-xs text-muted-foreground">{t("requests.loadingApplications")}</p>
            ) : bids.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3">{t("requests.noApplications")}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {bids.map((bid) => {
                  const phone = (bid.provider?.phone ?? "").replace(/[^\d+]/g, "");
                  const waMsg = t("requestsExtra.whatsappAcceptMsg", { name: bid.provider?.name ?? t("requestsExtra.providerFallback"), providerName: bid.provider?.name ?? t("requestsExtra.providerFallback"), category: r.category });
                  const wa = phone
                    ? `https://wa.me/${phone}?text=${encodeURIComponent(waMsg)}`
                    : null;
                  return (
                    <div key={bid.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/50">
                      <Avatar className="h-9 w-9 rounded-lg shrink-0">
                        {bid.provider?.photo_url ? (
                          <AvatarImage src={bid.provider.photo_url} alt={bid.provider.name} className="object-cover" />
                        ) : null}
                        <AvatarFallback className="rounded-lg bg-primary/10 text-primary text-xs font-semibold">
                          {bid.provider?.name?.charAt(0) ?? "?"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{bid.provider?.name ?? t("requestsExtra.providerFallback")}</p>
                        <p className="text-[11px] text-muted-foreground">{bid.provider?.category ? translateCategoryName(bid.provider.category, cats2 as { id: string; name: string; name_en: string | null; name_fr: string | null }[], i18n.language) : ""}</p>
                        {bid.message && <p className="text-xs text-muted-foreground mt-0.5 italic">"{bid.message}"</p>}
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        {bid.status === "pendente" && !isConcluded ? (
                          <>
                            <Button
                              size="sm"
                              onClick={() => onBidStatus(bid.id, "aceite")}
                              className="h-7 text-[11px] bg-green-600 hover:bg-green-700 text-white gap-1"
                            >
                              <CheckCircle2 className="h-3 w-3" /> {t("requests.accept")}
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => onBidStatus(bid.id, "recusado")}
                              className="h-7 text-[11px] gap-1"
                            >
                              <XCircle className="h-3 w-3" /> {t("requests.reject")}
                            </Button>
                          </>
                        ) : (
                          <Badge variant={bid.status === "aceite" ? "default" : "secondary"} className="text-[10px]">
                            {bid.status === "aceite" ? t("requests.accepted") : t("requests.rejected")}
                          </Badge>
                        )}
                      </div>
                      {bid.status === "aceite" && wa && (
                        <a href={wa} target="_blank" rel="noopener noreferrer" className="block mt-1">
                          <Button size="sm" className="w-full bg-[#25D366] hover:bg-[#1ebe57] text-white gap-1 h-7 text-[11px]">
                            <MessageCircle className="h-3 w-3" /> {t("requests.whatsapp")}
                          </Button>
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Botões de ação pós-aceite */}
            {acceptedBid && !isConcluded && (
              <Button
                onClick={() => onMarkCompleted(r.id)}
                className="w-full mt-3 bg-green-600 hover:bg-green-700 text-white gap-2"
                size="sm"
              >
                <CheckCircle2 className="h-4 w-4" /> {t("requests.markCompleted")}
              </Button>
            )}

            {isConcluded && acceptedBid && (
              <Button
                onClick={() => onReview(r.id, acceptedBid.provider_id, acceptedBid.provider?.name ?? t("requestsExtra.providerFallback"))}
                className="w-full mt-3 gap-2"
                size="sm"
                variant="outline"
              >
                <Star className="h-4 w-4" /> {t("requests.rateProviderAction")}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default Requests;
