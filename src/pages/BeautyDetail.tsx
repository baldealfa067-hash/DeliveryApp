import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, MapPin, Phone, BadgeCheck, CheckCircle2, ShieldAlert, Scissors, Loader2, ShoppingCart, Plus, Minus, MessageSquare, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { StarRating } from "@/components/StarRating";
import { ImagePreviewModal } from "@/components/ImagePreviewModal";
import { formatCFA } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { sanitizeName, sanitizeComment, sanitizeReason, sanitizeDescription, sanitizeContact } from "@/lib/sanitize";
import { useBeautyCategories } from "@/hooks/useProviders";
import { translateCategoryName } from "@/lib/categoryI18n";
import { useUnreadFromUser } from "@/hooks/useChat";
import { useRequireClientAuth } from "@/hooks/useRequireClientAuth";
import { ClientSignupDialog } from "@/components/ClientSignupDialog";
import { useCreateAppointment } from "@/hooks/useAppointments";
import { Calendar } from "@/components/ui/calendar";

type ReportReasonKey = "food" | "charge" | "behaviour" | "fake" | "hygiene" | "other";
const REPORT_REASONS: { key: ReportReasonKey; labelKey: string }[] = [
  { key: "food", labelKey: "businessDetail.reportReasons.food" },
  { key: "behaviour", labelKey: "businessDetail.reportReasons.behaviour" },
  { key: "fake", labelKey: "businessDetail.reportReasons.fake" },
  { key: "hygiene", labelKey: "businessDetail.reportReasons.hygiene" },
  { key: "other", labelKey: "businessDetail.reportReasons.other" },
];

type BeautyItem = { id: string; name: string; price_type: string; price: number | null; photo_url: string | null };
type Review = { id: string; rating: number; comment: string | null; created_at: string; reviewer_name: string | null };

const BeautyDetail = () => {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: beautyCats = [] } = useBeautyCategories();
  const [loading, setLoading] = useState(true);
  const [business, setBusiness] = useState<Record<string, unknown> | null>(null);
  const [items, setItems] = useState<BeautyItem[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const viewLogged = useRef(false);
  const [complaining, setComplaining] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportStep, setReportStep] = useState<"form" | "success">("form");
  const [reportReason, setReportReason] = useState("");
  const [reportDescription, setReportDescription] = useState("");
  const [reportContact, setReportContact] = useState("");
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(0);
  const [reviewerName, setReviewerName] = useState("");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [sending, setSending] = useState(false);
  const [appointmentOpen, setAppointmentOpen] = useState(false);
  const [selectedService, setSelectedService] = useState<BeautyItem | null>(null);
  const [appointmentName, setAppointmentName] = useState("");
  const [appointmentPhone, setAppointmentPhone] = useState("");
  const [appointmentDate, setAppointmentDate] = useState("");
  const [appointmentTime, setAppointmentTime] = useState("");
  const [appointmentNotes, setAppointmentNotes] = useState("");
  const createAppointment = useCreateAppointment();
  const beautyUserId = business ? String((business as Record<string, unknown>).user_id ?? "") : "";
  const isOwnProfile = user?.id === beautyUserId && !!user;
  const { data: unreadCount = 0 } = useUnreadFromUser(user?.id ?? null, beautyUserId || null);
  const { requireAuth, open: signupOpen, setOpen: setSignupOpen, onSignupSuccess } = useRequireClientAuth();

  useEffect(() => {
    if (!id) return;
    if (!viewLogged.current) {
      viewLogged.current = true;
      supabase.rpc("increment_provider_view", { p_provider_id: id }).then(({ error }) => {
        if (error) console.error("[stats] increment_provider_view error:", error.message);
      });
    }
    (async () => {
      const [{ data: profile }, { data: its }, { data: revs }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", id).maybeSingle(),
        supabase.from("beauty_items").select("id, name, price_type, price, photo_url").eq("business_id", id).order("name"),
        supabase.from("reviews").select("id, rating, comment, created_at, reviewer_name").eq("provider_id", id).eq("status", "aprovado").order("created_at", { ascending: false }),
      ]);
      setBusiness(profile as Record<string, unknown> | null);
      setItems((its ?? []) as BeautyItem[]);
      setReviews((revs ?? []) as Review[]);
      setLoading(false);
    })();
  }, [id]);

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen text-muted-foreground">{t("common.loading")}</div>;
  }

  if (!business || business.profile_type !== "beleza") {
    return <div className="flex items-center justify-center min-h-screen text-muted-foreground">{t("beautyDetail.notFound")}</div>;
  }

  const name = String(business.name ?? "");
  const phone = String(business.phone ?? "");
  const category = String(business.category ?? "");
  const location = String(business.location ?? "");
  const description = (business.description as string | null) ?? null;
  const photoUrl = (business.photo_url as string | null) ?? null;
  const isVerified = Boolean(business.is_verified);
  const avgRating = reviews.length ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10 : 0;

  const trackCall = () => {
    if (!id) return;
    supabase.rpc("record_provider_contact", { p_provider_id: id, contact_type: "call" }).then(({ error }) => {
      if (error) console.error("[stats] record call error:", error.message);
    });
  };

  const addToCart = (itemId: string) => setCart((c) => ({ ...c, [itemId]: (c[itemId] ?? 0) + 1 }));
  const removeFromCart = (itemId: string) => {
    setCart((c) => {
      const qty = (c[itemId] ?? 0) - 1;
      if (qty <= 0) {
        const { [itemId]: _, ...rest } = c;
        return rest;
      }
      return { ...c, [itemId]: qty };
    });
  };

  const cartItems = items.filter((i) => (cart[i.id] ?? 0) > 0);
  const cartCount = cartItems.reduce((sum, i) => sum + (cart[i.id] ?? 0), 0);
  const fixedTotal = cartItems.reduce((sum, i) => sum + (i.price ?? 0) * (cart[i.id] ?? 0), 0);

  const sendCartToWhatsapp = async () => {
    if (!id || !phone) return;
    if (!cartItems.length) return toast.error(t("businessDetail.addItems"));
    setSending(true);
    const lines = cartItems
      .map((i) => {
        const priceText = i.price_type === "fixo" && i.price != null ? formatCFA(i.price * (cart[i.id] ?? 0)) : t("common.toCombine");
        return t("businessDetailExtra.orderLine", { name: i.name, qty: cart[i.id], price: priceText });
      })
      .join("\n");
    const hasFixed = cartItems.some((i) => i.price_type === "fixo" && i.price != null);
    const totalLine = hasFixed ? `\n${t("businessDetailExtra.orderTotal", { total: formatCFA(fixedTotal) })}` : "";
    const message = `${t("businessDetailExtra.orderGreeting", { name })}\n\n${lines}\n${totalLine}`;
    const waUrl = `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
    supabase.rpc("record_provider_contact", { p_provider_id: id, contact_type: "whatsapp" }).then(({ error }) => {
      if (error) console.error("[stats] record whatsapp error:", error.message);
    });
    window.open(waUrl, "_blank");
    setSending(false);
    toast.success(t("businessDetail.orderSuccess"));
    setCart({});
  };

  const openAppointment = (service: BeautyItem) => {
    setSelectedService(service);
    setAppointmentName("");
    setAppointmentPhone("");
    setAppointmentDate("");
    setAppointmentTime("");
    setAppointmentNotes("");
    setAppointmentOpen(true);
  };

  const confirmAppointment = async () => {
    if (!id || !selectedService) return;
    if (!appointmentName.trim()) return toast.error(t("beautyDetail.enterName"));
    if (!appointmentPhone.trim()) return toast.error(t("beautyDetail.enterPhone"));
    if (!appointmentDate) return toast.error(t("beautyDetail.selectDate"));
    if (!appointmentTime) return toast.error(t("beautyDetail.selectTime"));
    setSending(true);
    try {
      await createAppointment.mutateAsync({
        businessId: id,
        customerId: user?.id ?? null,
        customerName: appointmentName.trim(),
        customerPhone: appointmentPhone.trim(),
        serviceName: selectedService.name,
        servicePrice: selectedService.price_type === "fixo" ? selectedService.price : null,
        appointmentDate,
        appointmentTime,
        notes: appointmentNotes.trim() || undefined,
      });
      toast.success(t("beautyDetail.appointmentSuccess"));
      setAppointmentOpen(false);
    } catch (err) {
      console.error("[appointment] error:", err);
      toast.error(t("beautyDetail.appointmentError"));
    } finally {
      setSending(false);
    }
  };

  const openReport = () => {
    setReportReason("");
    setReportDescription("");
    setReportContact("");
    setReportStep("form");
    setReportOpen(true);
  };

  const submitDirectReview = async () => {
    if (!id) return;
    if (rating < 1) {
      toast.error(t("businessDetail.selectStars"));
      return;
    }
    const cleanName = sanitizeName(reviewerName);
    if (!cleanName) {
      toast.error(t("businessDetail.enterName"));
      return;
    }
    const cleanComment = sanitizeComment(comment) || null;
    setSubmitting(true);
    const { error } = await supabase.from("reviews").insert({
      provider_id: id,
      rating,
      comment: cleanComment,
      reviewer_name: cleanName,
      user_id: user?.id ?? null,
      request_id: null,
    } as never);
    setSubmitting(false);
    if (error) {
      toast.error(t("businessDetail.reviewError") + ": " + error.message);
      return;
    }
    toast.success(t("businessDetail.reviewSent"));
    setRating(0);
    setReviewerName("");
    setComment("");
    queryClient.invalidateQueries({ queryKey: ["provider", id] });
  };

  const submitReport = async () => {
    if (!id) return;
    const cleanReason = sanitizeReason(reportReason);
    const cleanDesc = sanitizeDescription(reportDescription);
    if (!cleanReason || !cleanDesc) {
      toast.error(t("businessDetail.chooseReasonDesc"));
      return;
    }
    const cleanContact = sanitizeContact(reportContact) || null;
    setComplaining(true);
    try {
      const { error } = await supabase.from("complaints").insert({
        provider_id: id,
        client_id: user?.id ?? null,
        reason: cleanReason,
        description: cleanDesc,
        contact: cleanContact,
        status: "pendente",
      });
      if (error) {
        console.error("[complaints] error:", error.message);
        toast.error(t("businessDetail.reportError"));
      } else {
        setReportStep("success");
      }
    } catch (e) {
      console.error("[complaints] exception:", e);
      toast.error(t("businessDetail.reportError"));
    } finally {
      setComplaining(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto px-4 pt-6">
      <div className="flex items-start gap-4 mb-6">
        <Avatar className="h-20 w-20 rounded-xl">
          {photoUrl ? (
            <AvatarImage src={photoUrl} alt={name} className="object-cover" />
          ) : null}
          <AvatarFallback className="rounded-xl bg-primary/10 text-primary text-2xl font-bold">
            {name.charAt(0)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <h1 className="text-xl font-bold flex items-center gap-1.5">
            {name}
            {isVerified && (
              <BadgeCheck className="h-5 w-5 text-primary" aria-label={t("businessDetailExtra.verifiedLabel")} />
            )}
          </h1>
          <Badge variant="secondary" className="mt-1 flex items-center gap-1">
            <Scissors className="h-3 w-3" /> {translateCategoryName(category, beautyCats as { id: string; name: string; name_en: string | null; name_fr: string | null }[], i18n.language)}
          </Badge>
          <div className="flex items-center gap-2 mt-2">
            <StarRating rating={Math.round(avgRating)} size="md" />
            <span className="text-sm text-muted-foreground">
              {avgRating.toFixed(1)} ({reviews.length})
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-2 mb-6 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <MapPin className="h-4 w-4" />
          <span>{location}</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Phone className="h-4 w-4" />
          <span>{phone}</span>
        </div>
        {String((business as Record<string, unknown>).user_id ?? "") !== (user?.id ?? "") && (
          <Button variant="outline" className="w-full gap-2" onClick={openReport}>
            <AlertCircle className="h-5 w-5" />
            {t("businessDetail.report")}
          </Button>
        )}
      </div>

      {description && (
        <div className="mb-6">
          <h2 className="font-semibold mb-1">{t("businessDetail.about")}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      )}

      {items.length > 0 && (
        <div className="mb-6">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <Scissors className="h-5 w-5 text-primary" /> {t("beautyDetail.catalogTitle")}
          </h2>
          <div className="flex flex-col gap-2">
            {items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                qty={cart[item.id] ?? 0}
                onAdd={() => addToCart(item.id)}
                onRemove={() => removeFromCart(item.id)}
              />
            ))}
          </div>
        </div>
      )}

      {cartItems.length > 0 && (
        <Card className="mb-6 border-primary/40">
          <CardContent className="p-4">
            <h2 className="font-semibold mb-2 flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-primary" /> {t("businessDetail.orderTitle", { count: cartCount })}
            </h2>
            <div className="flex flex-col gap-1.5 mb-3">
              {cartItems.map((i) => (
                <div key={i.id} className="flex items-center justify-between text-sm">
                  <span className="min-w-0 truncate">{i.name} x{cart[i.id]}</span>
                  {i.price_type === "fixo" && i.price != null ? (
                    <span className="font-medium shrink-0">{formatCFA(i.price * (cart[i.id] ?? 0))}</span>
                  ) : (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">{t("common.toCombine")}</Badge>
                  )}
                </div>
              ))}
              {cartItems.some((i) => i.price_type === "fixo" && i.price != null) && (
                <div className="flex items-center justify-between text-sm font-bold border-t pt-1.5">
                  <span>{t("businessDetail.estimatedTotal")}</span>
                  <span>{formatCFA(fixedTotal)}</span>
                </div>
              )}
            </div>

            <Button onClick={sendCartToWhatsapp} disabled={sending} className="w-full bg-[#25D366] hover:bg-[#1ebe57] text-white gap-2">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-5 w-5" />}
              {sending ? t("businessDetail.registering") : t("businessDetail.sendOrder")}
            </Button>
            <p className="text-[11px] text-muted-foreground text-center mt-2">
              {t("businessDetail.orderHint")}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="mb-8 space-y-2">
        {!isOwnProfile && (
          <Button
            className="w-full gap-2 h-12 text-base font-semibold relative"
            onClick={() => requireAuth(() => beautyUserId && navigate(`/mensagem/${beautyUserId}`))}
          >
            <MessageSquare className="h-5 w-5" />
            {t("common.message")}
            {unreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground text-[10px] font-bold h-5 min-w-[20px] rounded-full flex items-center justify-center px-1">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Button>
        )}
        <a href={`tel:${phone.replace(/\s/g, "")}`} className="block" onClick={trackCall}>
          <Button variant="secondary" className="w-full gap-2">
            <Phone className="h-5 w-5" />
            {t("common.call")}
          </Button>
        </a>
      </div>

      <section>
        <h2 className="font-semibold mb-3">{t("businessDetail.reviewsCount", { count: reviews.length })}</h2>

        <div className="p-4 rounded-lg border bg-card mb-4 space-y-3">
          <p className="text-sm font-medium">{t("businessDetail.leaveReview")}</p>
          <div className="flex items-center gap-2">
            <StarRating rating={rating} onChange={setRating} size="md" />
          </div>
          <Input
            placeholder={t("businessDetail.yourName")}
            value={reviewerName}
            onChange={(e) => setReviewerName(e.target.value)}
          />
          <Textarea
            placeholder={t("businessDetail.commentOptional")}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
          />
          <Button onClick={submitDirectReview} disabled={submitting} className="w-full">
            {submitting ? t("businessDetail.sending") : t("businessDetail.submitReview")}
          </Button>
          {!user && (
            <p className="text-xs text-muted-foreground text-center">{t("businessDetail.anonymousReviewNote")}</p>
          )}
        </div>

        {reviews.length > 0 ? (
          <div className="flex flex-col gap-3">
            {reviews.map((r) => (
              <div key={r.id} className="p-3 rounded-lg border bg-card">
                <StarRating rating={r.rating} />
                {r.reviewer_name && (
                  <p className="text-sm font-medium mt-1">{r.reviewer_name}</p>
                )}
                {r.comment && <p className="text-sm mt-1">{r.comment}</p>}
                <p className="text-[11px] text-muted-foreground mt-1">
                  {new Date(r.created_at).toLocaleDateString(i18n.language)}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("businessDetail.noReviews")}</p>
        )}
      </section>

      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent>
          {reportStep === "form" && (
            <>
              <DialogHeader>
                <DialogTitle>{t("businessDetail.reportTitle", { name })}</DialogTitle>
                <DialogDescription>
                  {t("businessDetail.reportDesc")}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="grid gap-2">
                  <Label htmlFor="report-reason">{t("businessDetail.reason")}</Label>
                  <Select value={reportReason} onValueChange={setReportReason}>
                    <SelectTrigger id="report-reason">
                      <SelectValue placeholder={t("businessDetail.selectReason")} />
                    </SelectTrigger>
                    <SelectContent>
                      {REPORT_REASONS.map((r) => (
                        <SelectItem key={r.key} value={t(r.labelKey)}>{t(r.labelKey)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="report-description">{t("businessDetail.description")}</Label>
                  <Textarea
                    id="report-description"
                    placeholder={t("businessDetail.descriptionPlaceholder")}
                    value={reportDescription}
                    onChange={(e) => setReportDescription(e.target.value)}
                    rows={4}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="report-contact">{t("businessDetail.contactOptional")}</Label>
                  <Input
                    id="report-contact"
                    type="tel"
                    placeholder={t("businessDetail.contactPlaceholder")}
                    value={reportContact}
                    onChange={(e) => setReportContact(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("businessDetail.contactHint")}
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setReportOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <Button
                  onClick={submitReport}
                  disabled={complaining || !reportReason || !reportDescription.trim()}
                  className="gap-2"
                >
                  <ShieldAlert className="h-4 w-4" />
                  {complaining ? t("businessDetail.sending") : t("businessDetail.submitReport")}
                </Button>
              </DialogFooter>
            </>
          )}

          {reportStep === "success" && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  {t("businessDetail.reportSent")}
                </DialogTitle>
                <DialogDescription>
                  {t("businessDetail.reportSentDesc")}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button onClick={() => setReportOpen(false)}>{t("common.close")}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Appointment Dialog */}
      <Dialog open={appointmentOpen} onOpenChange={setAppointmentOpen}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("beautyDetail.bookService")}</DialogTitle>
            <DialogDescription>{selectedService?.name}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="apt-name">{t("beautyDetail.customerName")}</Label>
              <Input
                id="apt-name"
                placeholder={t("beautyDetail.yourName")}
                value={appointmentName}
                onChange={(e) => setAppointmentName(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="apt-phone">{t("beautyDetail.customerPhone")}</Label>
              <Input
                id="apt-phone"
                type="tel"
                placeholder={t("beautyDetail.phonePlaceholder")}
                value={appointmentPhone}
                onChange={(e) => setAppointmentPhone(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="apt-date">{t("beautyDetail.appointmentDate")}</Label>
              <Input
                id="apt-date"
                type="date"
                min={new Date().toISOString().split("T")[0]}
                value={appointmentDate}
                onChange={(e) => setAppointmentDate(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="apt-time">{t("beautyDetail.appointmentTime")}</Label>
              <Input
                id="apt-time"
                type="time"
                value={appointmentTime}
                onChange={(e) => setAppointmentTime(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="apt-notes">{t("beautyDetail.appointmentNotes")}</Label>
              <Textarea
                id="apt-notes"
                placeholder={t("beautyDetail.appointmentNotesPlaceholder")}
                value={appointmentNotes}
                onChange={(e) => setAppointmentNotes(e.target.value)}
                rows={2}
              />
            </div>
            {selectedService && selectedService.price_type === "fixo" && selectedService.price != null && (
              <div className="p-2 bg-muted/50 rounded-lg">
                <p className="text-xs text-muted-foreground">{t("beautyDetail.estimatedPrice")}</p>
                <p className="text-sm font-bold">{formatCFA(selectedService.price)}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAppointmentOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={confirmAppointment}
              disabled={sending || !appointmentName.trim() || !appointmentPhone.trim() || !appointmentDate || !appointmentTime}
              className="gap-2"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calendar className="h-4 w-4" />}
              {sending ? t("common.saving") : t("beautyDetail.bookService")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ClientSignupDialog open={signupOpen} onOpenChange={setSignupOpen} onSuccess={onSignupSuccess} />
    </div>
  );
};

const ItemRow = ({ item, qty, onAdd, onRemove }: { item: BeautyItem; qty: number; onAdd: () => void; onRemove: () => void }) => {
  const { t } = useTranslation();
  const isFixed = item.price_type === "fixo" && item.price != null;
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-2.5">
      {item.photo_url ? (
        <ImagePreviewModal src={item.photo_url} alt={item.name} />
      ) : (
        <div className="h-14 w-14 rounded-lg bg-muted flex items-center justify-center text-muted-foreground shrink-0">
          <Scissors className="h-5 w-5" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{item.name}</div>
        {isFixed ? (
          <div className="text-sm font-semibold text-primary">{formatCFA(item.price!)}</div>
        ) : (
          <Badge variant="secondary" className="text-[11px] mt-0.5">{t("common.toCombine")}</Badge>
        )}
      </div>
      {qty === 0 ? (
        <Button size="sm" variant="outline" className="shrink-0 gap-1" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5" /> {t("common.add")}
        </Button>
      ) : (
        <div className="flex items-center gap-1 shrink-0">
          <Button size="icon" variant="outline" className="h-8 w-8" onClick={onRemove}>
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <span className="w-6 text-center font-semibold text-sm">{qty}</span>
          <Button size="icon" className="h-8 w-8" onClick={onAdd}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
};

export default BeautyDetail;
