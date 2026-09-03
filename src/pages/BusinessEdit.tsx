import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  LogOut,
  ArrowLeft,
  Upload,
  Loader2,
  Trash2,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  FileCheck2,
  Store,
  UtensilsCrossed,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useBusinessCategories } from "@/hooks/useProviders";
import { useBairros } from "@/hooks/useBairros";
import { toast } from "sonner";
import { LOCATION_OPTIONS } from "@/lib/locations";
import { canSubmitVerification, verificationDescription } from "@/lib/verification";
import ManageList from "@/components/ManageList";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { formatCFA } from "@/lib/format";
import { useTranslation } from "react-i18next";
import { LanguageSelector } from "@/components/LanguageSelector";
import { getCategoryName } from "@/lib/categoryI18n";

type ConsumptionOption = "comer_no_local" | "para_levar" | "entrega";

const CONSUMPTION_OPTIONS: { value: ConsumptionOption; labelKey: string; descKey: string }[] = [
  { value: "comer_no_local", labelKey: "businessEdit.eatIn", descKey: "businessEdit.eatInDesc" },
  { value: "para_levar", labelKey: "businessEdit.takeAway", descKey: "businessEdit.takeAwayDesc" },
  { value: "entrega", labelKey: "businessEdit.delivery", descKey: "businessEdit.deliveryDesc" },
];

type Form = {
  name: string;
  category: string;
  phone: string;
  location: string;
  description: string;
  photo_url: string;
  consumption_options: ConsumptionOption[];
};

const empty: Form = {
  name: "",
  category: "",
  phone: "",
  location: "",
  description: "",
  photo_url: "",
  consumption_options: [],
};

type MenuCategory = { id: string; name: string };
type MenuItem = { id: string; name: string; price: number; photo_url: string | null; category_id: string | null };

const BusinessDashboard = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, isBusiness, isAdmin, rolesLoaded, loading, signOut } = useAuth();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(empty);
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: categories = [] } = useBusinessCategories();
  const { data: bairros = [] } = useBairros();
  const locationOptions = bairros.length ? bairros : LOCATION_OPTIONS;
  const [verificationStatus, setVerificationStatus] = useState<string>("none");
  const [verificationReason, setVerificationReason] = useState<string | null>(null);
  const [verifyDoc, setVerifyDoc] = useState<File | null>(null);
  const [verifySelfie, setVerifySelfie] = useState<File | null>(null);
  const [verifying, setVerifying] = useState(false);
  const verifyDocRef = useRef<HTMLInputElement>(null);
  const verifySelfieRef = useRef<HTMLInputElement>(null);

  const [menuCategories, setMenuCategories] = useState<MenuCategory[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [orderCount, setOrderCount] = useState(0);
  const [categoryToDelete, setCategoryToDelete] = useState<MenuCategory | null>(null);
  const [itemToDelete, setItemToDelete] = useState<MenuItem | null>(null);

  const [itemForm, setItemForm] = useState({ name: "", price: "", category_id: "", photo_url: "" });
  const [itemUploading, setItemUploading] = useState(false);
  const itemFileRef = useRef<HTMLInputElement>(null);

  const loadMenu = async (pid: string) => {
    const [{ data: cats }, { data: items }, { count: orders }] = await Promise.all([
      supabase.from("menu_categories").select("id, name").eq("business_id", pid).order("name"),
      supabase.from("menu_items").select("id, name, price, photo_url, category_id").eq("business_id", pid).order("name"),
      supabase.from("orders").select("id", { count: "exact", head: true }).eq("business_id", pid),
    ]);
    setMenuCategories((cats ?? []) as MenuCategory[]);
    setMenuItems((items ?? []) as MenuItem[]);
    setOrderCount(orders ?? 0);
  };

  useEffect(() => {
    if (loading || !rolesLoaded) return;
    if (!user) return navigate("/login", { replace: true });
    if (!isBusiness && !isAdmin) return navigate("/inicio", { replace: true });
    (async () => {
      const { data } = await supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle();
      if (data) {
        setProfileId(data.id);
        setVerificationStatus(data.verification_status ?? "none");
        setVerificationReason(data.verification_reason);
        setForm({
          name: data.name ?? "",
          category: data.category ?? "",
          phone: data.phone ?? "",
          location: data.location ?? "",
          description: data.description ?? "",
          photo_url: data.photo_url ?? "",
          consumption_options: ((data.consumption_options ?? []) as ConsumptionOption[]).filter((o) =>
            ["comer_no_local", "para_levar", "entrega"].includes(o)
          ),
        });
        loadMenu(data.id);
      }
      setFetching(false);
    })();
  }, [user, isBusiness, isAdmin, rolesLoaded, loading, navigate]);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (file.size > 5 * 1024 * 1024) return toast.error(t("businessEdit.imageTooLarge"));
    setUploading(true);
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${user.id}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true, contentType: file.type });
    if (error) { setUploading(false); return toast.error(error.message); }
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    setForm((f) => ({ ...f, photo_url: data.publicUrl }));
    setUploading(false);
    toast.success(t("businessEdit.photoUploaded"));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleItemPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (file.size > 5 * 1024 * 1024) return toast.error(t("businessEdit.imageTooLarge"));
    setItemUploading(true);
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${user.id}/menu/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("portfolio").upload(path, file, { contentType: file.type });
    if (error) { setItemUploading(false); return toast.error(error.message); }
    const { data } = supabase.storage.from("portfolio").getPublicUrl(path);
    setItemForm((f) => ({ ...f, photo_url: data.publicUrl }));
    setItemUploading(false);
    toast.success(t("businessEdit.itemPhotoUploaded"));
    if (itemFileRef.current) itemFileRef.current.value = "";
  };

  const submitVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !profileId) return;
    if (!verifyDoc || !verifySelfie) return toast.error(t("businessEdit.needDocs"));
    if (verifyDoc.size > 5 * 1024 * 1024 || verifySelfie.size > 5 * 1024 * 1024) {
      return toast.error(t("businessEdit.filesTooLarge"));
    }
    setVerifying(true);
    const ext = (f: File) => f.name.split(".").pop()?.toLowerCase() || "jpg";
    const docPath = `${user.id}/doc-${Date.now()}.${ext(verifyDoc)}`;
    const selfiePath = `${user.id}/selfie-${Date.now()}.${ext(verifySelfie)}`;
    const { error: docErr } = await supabase.storage.from("verification").upload(docPath, verifyDoc, { contentType: verifyDoc.type });
    if (docErr) { setVerifying(false); return toast.error(docErr.message); }
    const { error: selfieErr } = await supabase.storage.from("verification").upload(selfiePath, verifySelfie, { contentType: verifySelfie.type });
    if (selfieErr) { setVerifying(false); return toast.error(selfieErr.message); }
    const { error } = await supabase.from("profiles").update({
      verification_status: "pendente",
      verification_doc_url: docPath,
      verification_selfie_url: selfiePath,
      verification_reason: null,
      verification_submitted_at: new Date().toISOString(),
    }).eq("id", profileId);
    setVerifying(false);
    if (error) return toast.error(error.message);
    setVerificationStatus("pendente");
    setVerificationReason(null);
    setVerifyDoc(null);
    setVerifySelfie(null);
    toast.success(t("businessEdit.verificationSubmitted"));
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!form.name || !form.category || !form.phone || !form.location) {
      return toast.error(t("businessEdit.requiredFields"));
    }
    if (!form.consumption_options.length) {
      return toast.error(t("businessEdit.needConsumption"));
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      category: form.category.trim(),
      phone: form.phone.trim(),
      location: form.location.trim(),
      description: form.description.trim() || null,
      photo_url: form.photo_url.trim() || null,
      consumption_options: form.consumption_options,
      profile_type: "business",
      price_type: "combinar",
      user_id: user.id,
    };
    const { error, data } = profileId
      ? await supabase.from("profiles").update(payload).eq("id", profileId).select().single()
      : await supabase.from("profiles").insert(payload).select().single();
    setSaving(false);
    if (error) return toast.error(error.message);
    if (data) {
      setProfileId(data.id);
      await supabase.rpc("register_as_business");
    }
    toast.success(t("businessEdit.profileSaved"));
  };

  const addMenuCategory = async (name: string) => {
    if (!profileId) return;
    const { error } = await supabase.from("menu_categories").insert({ business_id: profileId, name });
    if (error) return toast.error(error.message);
    toast.success(t("businessEdit.categoryAdded"));
    loadMenu(profileId);
  };

  const renameMenuCategory = async (id: string, name: string) => {
    if (!profileId) return;
    const { error } = await supabase.from("menu_categories").update({ name }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(t("businessEdit.categoryUpdated"));
    loadMenu(profileId);
  };

  const removeMenuCategory = async (id: string) => {
    if (!profileId) return;
    const { error } = await supabase.from("menu_categories").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(t("businessEdit.categoryDeleted"));
    loadMenu(profileId);
  };

  const addMenuItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileId) return;
    if (!itemForm.name.trim()) return toast.error(t("businessEdit.enterDishName"));
    const price = parseFloat(itemForm.price);
    if (isNaN(price) || price < 0) return toast.error(t("businessEdit.enterValidPrice"));
    const { error } = await supabase.from("menu_items").insert({
      business_id: profileId,
      category_id: itemForm.category_id || null,
      name: itemForm.name.trim(),
      price,
      photo_url: itemForm.photo_url || null,
    });
    if (error) return toast.error(error.message);
    toast.success(t("businessEdit.itemAdded"));
    setItemForm({ name: "", price: "", category_id: "", photo_url: "" });
    loadMenu(profileId);
  };

  const removeMenuItem = async (id: string) => {
    const { error } = await supabase.from("menu_items").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(t("businessEdit.itemRemoved"));
    if (profileId) loadMenu(profileId);
  };

  const categoryName = (cid: string | null) => menuCategories.find((c) => c.id === cid)?.name ?? t("businessEdit.noCategoryLabel");

  if (loading || fetching) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">{t("businessEdit.loading")}</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/painel-loja" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground p-2 -m-2 rounded-md">
            <ArrowLeft className="h-4 w-4" /> {t("businessEdit.statistics")}
          </Link>
          <div className="flex items-center gap-2">
            <LanguageSelector />
            {isAdmin && (
              <Link to="/admin"><Button variant="outline" size="sm">{t("businessEdit.admin")}</Button></Link>
            )}
            <Button variant="ghost" size="sm" onClick={() => signOut().then(() => navigate("/"))} className="gap-1 min-h-11">
              <LogOut className="h-4 w-4" /> {t("businessEdit.logout")}
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 pb-[calc(env(safe-area-inset-bottom))]">
        <h1 className="text-2xl font-bold mb-1 flex items-center gap-2">
          <Store className="h-6 w-6 text-primary" /> {t("businessEdit.myBusiness")}
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          {profileId ? t("businessEdit.updateData") : t("businessEdit.completeToAppear")}
        </p>

        <Card>
          <CardHeader><CardTitle className="text-base">{t("businessEdit.businessData")}</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={save} className="grid gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <Avatar className="h-20 w-20 rounded-xl self-start">
                  {form.photo_url ? <AvatarImage src={form.photo_url} className="object-cover" /> : null}
                  <AvatarFallback className="rounded-xl bg-primary/10 text-primary text-xl font-bold">
                    {form.name.charAt(0) || "?"}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handlePhotoUpload}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                    className="gap-2 min-h-11 w-full sm:w-auto"
                  >
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {t("businessEdit.uploadPhoto")}
                  </Button>
                  <p className="text-[11px] text-muted-foreground mt-1">{t("businessEdit.jpgPngMax")}</p>
                </div>
              </div>
              <Field label={t("businessEdit.nameRequired")}>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label={t("businessEdit.categoryRequired")}>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger><SelectValue placeholder={t("businessEdit.selectCategory")} /></SelectTrigger>
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
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={t("businessEdit.phoneRequired")}>
                  <Input placeholder={t("businessEdit.phonePlaceholder")} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </Field>
                <Field label={t("businessEdit.locationRequired")}>
                  <Select value={form.location} onValueChange={(v) => setForm({ ...form, location: v })}>
                    <SelectTrigger><SelectValue placeholder={t("businessEdit.select")} /></SelectTrigger>
                    <SelectContent>
                      {locationOptions.map((opt) => (
                        <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field label={t("businessEdit.description")}>
                <Textarea rows={4} placeholder={t("businessEdit.descriptionPlaceholder")} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </Field>
              <Field label={t("businessEdit.consumptionTitle")}>
                <p className="text-[11px] text-muted-foreground -mt-1">{t("businessEdit.consumptionHint")}</p>
                <div className="flex flex-col gap-2">
                  {CONSUMPTION_OPTIONS.map((opt) => {
                    const active = form.consumption_options.includes(opt.value);
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() =>
                          setForm({
                            ...form,
                            consumption_options: active
                              ? form.consumption_options.filter((o) => o !== opt.value)
                              : [...form.consumption_options, opt.value],
                          })
                        }
                        className={
                          "flex items-start gap-2 rounded-lg border p-3 text-left transition-colors " +
                          (active ? "border-primary bg-primary/5" : "hover:bg-muted")
                        }
                      >
                        <span className={
                          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border " +
                          (active ? "border-primary bg-primary" : "border-border")
                        }>
                          {active && <span className="h-2 w-2 rounded-full bg-white" />}
                        </span>
                        <span className="min-w-0">
                          <span className={"block text-sm font-medium " + (active ? "text-primary" : "")}>{t(opt.labelKey)}</span>
                          <span className="block text-[11px] text-muted-foreground">{t(opt.descKey)}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Field>
              <Button type="submit" disabled={saving} className="w-full">
                {saving ? t("businessEdit.saving") : profileId ? t("businessEdit.saveChanges") : t("businessEdit.createProfile")}
              </Button>
            </form>
          </CardContent>
        </Card>

        {profileId && (
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <UtensilsCrossed className="h-5 w-5 text-primary" /> {t("businessEdit.menuTitle")}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {t("businessEdit.menuDesc")}
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div>
                <h3 className="text-sm font-semibold mb-2">{t("businessEdit.menuCategories")}</h3>
                <ManageList
                  placeholder={t("businessEdit.newCategoryPlaceholder")}
                  items={menuCategories}
                  onAdd={addMenuCategory}
                  onRename={renameMenuCategory}
                  onDelete={(id) => setCategoryToDelete(menuCategories.find((c) => c.id === id) ?? null)}
                  emptyText={t("businessEdit.noCategories")}
                />
              </div>
              <div>
                <h3 className="text-sm font-semibold mb-2">{t("businessEdit.menuItems", { count: menuItems.length })}</h3>
                <form onSubmit={addMenuItem} className="grid gap-3 rounded-lg border p-3 mb-3">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>{t("businessEdit.dishNameRequired")}</Label>
                      <Input value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} placeholder={t("businessEdit.dishPlaceholder")} />
                    </div>
                    <div className="space-y-1">
                      <Label>{t("businessEdit.priceRequired")}</Label>
                      <Input type="number" min="0" step="0.01" value={itemForm.price} onChange={(e) => setItemForm({ ...itemForm, price: e.target.value })} placeholder={t("businessEdit.pricePlaceholder")} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>{t("businessEdit.menuCategory")}</Label>
                    <Select value={itemForm.category_id} onValueChange={(v) => setItemForm({ ...itemForm, category_id: v })}>
                      <SelectTrigger><SelectValue placeholder={t("businessEdit.noCategory")} /></SelectTrigger>
                      <SelectContent>
                        {menuCategories.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      ref={itemFileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleItemPhotoUpload}
                    />
                    <Button type="button" variant="outline" disabled={itemUploading} onClick={() => itemFileRef.current?.click()} className="gap-2 min-h-11">
                      {itemUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      {itemForm.photo_url ? t("businessEdit.photoChosen") : t("businessEdit.photoOptional")}
                    </Button>
                    {itemForm.photo_url && (
                      <img src={itemForm.photo_url} alt="Prato" className="h-9 w-9 rounded-lg object-cover border" />
                    )}
                  </div>
                  <Button type="submit" className="gap-1 w-full">
                    <Plus className="h-4 w-4" /> {t("businessEdit.addItem")}
                  </Button>
                </form>
                <div className="flex flex-col gap-2">
                  {menuItems.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 rounded-lg border p-2.5">
                      {item.photo_url ? (
                        <img src={item.photo_url} alt={item.name} className="h-11 w-11 rounded-lg object-cover shrink-0" />
                      ) : (
                        <div className="h-11 w-11 rounded-lg bg-muted flex items-center justify-center text-muted-foreground shrink-0">
                          <UtensilsCrossed className="h-4 w-4" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{item.name}</div>
                        <div className="text-xs text-muted-foreground">{formatCFA(item.price)} · <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{categoryName(item.category_id)}</Badge></div>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => setItemToDelete(item)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                  {!menuItems.length && <p className="text-sm text-muted-foreground text-center py-4">{t("businessEdit.noItems")}</p>}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {profileId && (
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                {verificationStatus === "aprovado" && <ShieldCheck className="h-5 w-5 text-green-600" />}
                {verificationStatus === "pendente" && <ShieldAlert className="h-5 w-5 text-yellow-600" />}
                {verificationStatus === "rejeitado" && <ShieldX className="h-5 w-5 text-destructive" />}
                {verificationStatus === "none" && <ShieldCheck className="h-5 w-5 text-muted-foreground" />}
                {t("businessEdit.verificationTitle")}
              </CardTitle>
              {verificationStatus !== "aprovado" && (
                <p className="text-xs text-muted-foreground">
                  {t("businessEdit.verificationDesc")}
                </p>
              )}
            </CardHeader>
            <CardContent>
              {verificationStatus === "aprovado" && (
                <div className="flex items-center gap-2 text-green-700">
                  <ShieldCheck className="h-5 w-5" />
                  <span className="text-sm font-medium">{verificationDescription(verificationStatus)}</span>
                </div>
              )}

              {verificationStatus === "pendente" && (
                <p className="text-sm text-yellow-700">
                  {verificationDescription(verificationStatus)}
                </p>
              )}

              {verificationStatus === "rejeitado" && (
                <div className="mb-3 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  <p className="font-medium">{verificationDescription(verificationStatus)}</p>
                  {verificationReason && <p className="mt-1">{t("businessEdit.reason", { reason: verificationReason })}</p>}
                </div>
              )}

              {canSubmitVerification(verificationStatus) && (
                <form onSubmit={submitVerification} className="grid gap-4">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <Label>{t("businessEdit.docLabel")}</Label>
                      <input ref={verifyDocRef} type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => setVerifyDoc(e.target.files?.[0] ?? null)} />
                      <Button type="button" variant="outline" className="w-full justify-start gap-2" onClick={() => verifyDocRef.current?.click()}>
                        <FileCheck2 className="h-4 w-4" />
                        {verifyDoc ? verifyDoc.name : t("businessEdit.chooseDoc")}
                      </Button>
                    </div>
                    <div>
                      <Label>{t("businessEdit.selfieLabel")}</Label>
                      <input ref={verifySelfieRef} type="file" accept="image/*" className="hidden" onChange={(e) => setVerifySelfie(e.target.files?.[0] ?? null)} />
                      <Button type="button" variant="outline" className="w-full justify-start gap-2" onClick={() => verifySelfieRef.current?.click()}>
                        <Upload className="h-4 w-4" />
                        {verifySelfie ? verifySelfie.name : t("businessEdit.chooseSelfie")}
                      </Button>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {t("businessEdit.verificationHint")}
                  </p>
                  <Button type="submit" disabled={verifying} className="w-full">
                    {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {verifying ? t("businessEdit.submitting") : t("businessEdit.submitVerification")}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        )}

        {profileId && (
          <div className="mt-4 flex justify-center">
            <Link to={`/loja/${profileId}`} className="text-xs text-primary hover:underline inline-flex items-center justify-center min-h-11 w-full">
              {t("businessEdit.viewPublic")}
            </Link>
          </div>
        )}

        <ConfirmDialog
          open={categoryToDelete !== null}
          onOpenChange={(o) => { if (!o) setCategoryToDelete(null); }}
          title={t("businessEdit.deleteCategory")}
          description={t("businessEdit.deleteCategoryConfirm")}
          confirmLabel={t("businessEdit.delete")}
          destructive
          onConfirm={() => {
            if (categoryToDelete) removeMenuCategory(categoryToDelete.id);
            setCategoryToDelete(null);
          }}
        />

        <ConfirmDialog
          open={itemToDelete !== null}
          onOpenChange={(o) => { if (!o) setItemToDelete(null); }}
          title={t("businessEdit.removeItem")}
          description={itemToDelete ? t("businessEdit.removeItemConfirm", { name: itemToDelete.name }) : ""}
          confirmLabel={t("businessEdit.remove")}
          destructive
          onConfirm={() => {
            if (itemToDelete) removeMenuItem(itemToDelete.id);
            setItemToDelete(null);
          }}
        />
      </main>
    </div>
  );
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-1">
    <Label>{label}</Label>
    {children}
  </div>
);

export default BusinessDashboard;
