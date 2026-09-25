import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, MapPin, Phone, BadgeCheck, CheckCircle2, ShieldAlert, Store, UtensilsCrossed, Plus, Minus, ShoppingCart, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { StarRating } from "@/components/StarRating";
import { ImagePreviewModal } from "@/components/ImagePreviewModal";
import { formatCFA } from "@/lib/format";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/PhoneInput";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sanitizeName, sanitizeComment, sanitizeReason, sanitizeDescription, sanitizeContact } from "@/lib/sanitize";
import { useBusinessCategories } from "@/hooks/useProviders";
import { translateCategoryName } from "@/lib/categoryI18n";
import { useCreateOrder } from "@/hooks/useOrders";
import { useBairros } from "@/hooks/useBairros";
import { useDeliveryPrice } from "@/hooks/useFleet";
import { useRequireClientAuth } from "@/hooks/useRequireClientAuth";
import { ClientSignupDialog } from "@/components/ClientSignupDialog";
import { BISSAU_CENTER, type GeoPosition } from "@/hooks/useGeolocation";
import { useVoiceRecorder, formatDuration } from "@/hooks/useVoiceRecorder";
import { Mic, Square, Play, Pause, RotateCcw, Copy, Upload, Banknote, CreditCard, Check } from "lucide-react";
import { PUBLIC_PROFILE_COLUMNS } from "@/lib/profileColumns";
import { contactFromUser } from "@/lib/clientAuth";
import { COMPROVATIVOS_BUCKET, caminhoComprovativo } from "@/lib/comprovativos";
import { BUCKET_PRIVADO, caminhoPrivado, tipoSemParametros } from "@/lib/armazenamentoPrivado";

type ReportReasonKey = "food" | "charge" | "behaviour" | "fake" | "hygiene" | "other";
const REPORT_REASONS: { key: ReportReasonKey; labelKey: string }[] = [
  { key: "food", labelKey: "businessDetail.reportReasons.food" },
  { key: "charge", labelKey: "businessDetail.reportReasons.charge" },
  { key: "behaviour", labelKey: "businessDetail.reportReasons.behaviour" },
  { key: "fake", labelKey: "businessDetail.reportReasons.fake" },
  { key: "hygiene", labelKey: "businessDetail.reportReasons.hygiene" },
  { key: "other", labelKey: "businessDetail.reportReasons.other" },
];

const CONSUMPTION_LABEL_KEYS: Record<string, string> = {
  comer_no_local: "businessDetail.consumption.eatIn",
  para_levar: "businessDetail.consumption.takeAway",
  entrega: "businessDetail.consumption.delivery",
};

type MenuCategory = { id: string; name: string };
type MenuItem = { id: string; name: string; price: number; photo_url: string | null; category_id: string | null; track_stock: boolean; stock_qty: number | null; is_orderable: boolean };
type Review = { rating: number; comment: string | null; created_at: string };

const BusinessDetail = () => {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: bizCats = [] } = useBusinessCategories();
  const [loading, setLoading] = useState(true);
  const [business, setBusiness] = useState<Record<string, unknown> | null>(null);
  /**
   * Dados de pagamento do negócio, em estado PRÓPRIO e não fundidos em
   * `business`.
   *
   * Estiveram fundidos e a opção "Pagar Orange Money" desaparecia do checkout,
   * de forma silenciosa e quase sempre: a consulta do perfil espera por quatro
   * queries num Promise.all, esta é uma só e chega primeiro. Com `business`
   * ainda a null, o merge era descartado -- e o `setBusiness(profile)` que vem
   * a seguir sobrescreveria o objecto de qualquer maneira. O useEffect nunca
   * repete, portanto a informação perdia-se de vez.
   */
  const [paymentInfo, setPaymentInfo] = useState<{
    merchant_code: string | null;
    payment_number: string | null;
  } | null>(null);
  const [menuCategories, setMenuCategories] = useState<MenuCategory[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const viewLogged = useRef(false);
  const [complaining, setComplaining] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportStep, setReportStep] = useState<"form" | "success">("form");
  const [reportReason, setReportReason] = useState("");
  const [reportDescription, setReportDescription] = useState("");
  const [reportContact, setReportContact] = useState("");
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [cart, setCart] = useState<Record<string, number>>({});

  /**
   * Fase 2.5 — está aberto? Vem do servidor (`is_business_open`), que é a mesma
   * função que o `create_order` usa para travar. Calcular isto no browser a
   * partir dos períodos daria um ecrã que diz "Aberto" e um checkout que
   * recusa — a surpresa que o §83 proíbe.
   */
  const { data: horario } = useQuery({
    queryKey: ["horarios", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as unknown as (
        fn: string, args?: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message: string } | null }>)(
        "get_business_hours", { p_business_id: id },
      );
      if (error) throw new Error(error.message);
      return data as {
        aberto_agora: boolean;
        periodos: { weekday: number; opens_at: string; closes_at: string }[];
      };
    },
  });
  const lojaFechada = horario ? !horario.aberto_agora : false;
  const cartRef = useRef<HTMLDivElement | null>(null);
  const [typing, setTyping] = useState(false);
  const [consumptionOption, setConsumptionOption] = useState("");
  const [bairro, setBairro] = useState("");
  const [referencePoint, setReferencePoint] = useState("");
  const [deliveryPhone, setDeliveryPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [customerLocation, setCustomerLocation] = useState<GeoPosition | null>(null);
  const [voiceNoteUrl, setVoiceNoteUrl] = useState<string | null>(null);
  const [voiceUploading, setVoiceUploading] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"entrega" | "online">("entrega");
  /** Nome do objecto no bucket privado `comprovativos` (não é uma URL). */
  const [paymentProofUrl, setPaymentProofUrl] = useState<string | null>(null);
  /** Miniatura local do ficheiro escolhido: o bucket é privado, não há URL pública. */
  const [paymentProofPreview, setPaymentProofPreview] = useState<string | null>(null);
  const [paymentProofUploading, setPaymentProofUploading] = useState(false);
  const [paymentInfoLoaded, setPaymentInfoLoaded] = useState(false);
  const [confirmarAposLogin, setConfirmarAposLogin] = useState(false);
  const paymentSectionRef = useRef<HTMLDivElement | null>(null);
  const paymentProofRef = useRef<HTMLInputElement>(null);
  const [voicePlaying, setVoicePlaying] = useState(false);
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const recorder = useVoiceRecorder();
  const [orderConfirmOpen, setOrderConfirmOpen] = useState(false);
  const [orderCustomerName, setOrderCustomerName] = useState("");
  const [orderCustomerPhone, setOrderCustomerPhone] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  /* Nome e telefone vêm da conta: o cliente não repete o que já deu no registo.
     Só enche campos VAZIOS -- se ele os trocou (pedido para a mãe), não se
     escreve por cima. É só para este pedido; o perfil não é tocado. */
  const preencherContacto = () => {
    const { name, phone } = contactFromUser(user);
    if (name) setOrderCustomerName((v) => v || name);
    if (phone) {
      setDeliveryPhone((v) => v || phone);
      setOrderCustomerPhone((v) => v || phone);
    }
  };
  useEffect(() => {
    if (user) preencherContacto();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  const createOrder = useCreateOrder();
  const { data: bairros = [] } = useBairros();
  /* §14/§83: o cliente tem de saber a taxa de entrega ANTES de confirmar.
     O preço vem do bairro (§15), não da distância, e é resolvido no servidor --
     get_delivery_price() devolve só o valor aplicável, nunca a grelha de preços
     de nenhuma frota. */
  const { data: deliveryPrice, isLoading: deliveryPriceLoading } = useDeliveryPrice(bairro || null);
  const bizUserId = business ? String((business as Record<string, unknown>).user_id ?? "") : "";
  const isOwnProfile = user?.id === bizUserId && !!user;
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
      const [{ data: profile }, { data: cats }, { data: items }, { data: revs }] = await Promise.all([
        supabase.from("profiles").select(PUBLIC_PROFILE_COLUMNS).eq("id", id).maybeSingle(),
        supabase.from("menu_categories").select("id, name").eq("business_id", id).order("name"),
        supabase.from("menu_items").select("id, name, price, photo_url, category_id, track_stock, stock_qty, is_orderable").eq("business_id", id).order("name"),
        // Fase 9.4: as avaliacoes sao as do pedido concluido (`order_ratings`), nao
        // as da tabela `reviews` do Bornaal -- essa e a montra da beleza e nao tem
        // pedido por tras. O cliente ve-as antes de ter conta, mas pela RPC, nao
        // pela tabela: desde 2026-09-25 a tabela ja nao e publica, e a RPC so
        // devolve estrelas, comentario e data -- sem nome do cliente e sem ids.
        (
          supabase.rpc as unknown as (
            fn: string, args: Record<string, unknown>,
          ) => Promise<{ data: unknown; error: unknown }>
        )("get_business_reviews", { p_business_id: id }),
      ]);
      setBusiness(profile as Record<string, unknown> | null);
      setMenuCategories((cats ?? []) as MenuCategory[]);
      setMenuItems((items ?? []) as MenuItem[]);
      setReviews((revs ?? []) as Review[]);
      setLoading(false);
    })();
  }, [id]);

  // O código de comerciante e o número de pagamento deixaram de estar ao
  // alcance de quem não tem sessão (Fase 1): são identificadores de pagamento,
  // e um visitante anónimo não precisa deles para ver o menu. Quem tem conta
  // continua a precisar, porque é com eles que paga por Orange Money (§23) —
  // por isso vêm numa segunda consulta, só depois de haver sessão, e juntam-se
  // ao perfil já carregado.
  useEffect(() => {
    if (!id || !user) return;
    let cancelado = false;
    // Estas colunas deixaram de ser legiveis directamente por `authenticated`:
    // qualquer conta descarregava os dados de pagamento de todos os negocios
    // numa query. Saem agora por RPC, um negocio de cada vez.
    setPaymentInfoLoaded(false);
    (
      supabase.rpc as unknown as (
        fn: string, args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: unknown }>
    )("get_business_payment_info", { p_business_id: id }).then(({ data, error }) => {
      if (cancelado) return;
      setPaymentInfoLoaded(true);
      if (error) {
        console.error("[checkout] get_business_payment_info:", error);
        return;
      }
      const info = (data as Array<{ merchant_code: string | null; payment_number: string | null }>)?.[0];
      setPaymentInfo(info ?? null);
    });
    return () => {
      cancelado = true;
    };
  }, [id, user]);

  /* Quem entra SEM sessão só fica a saber que o restaurante aceita Orange Money
     depois do login (o código não é público). Abrir logo a confirmação, como
     antes, fechava o pedido em "pagar na entrega" sem o cliente ter visto a
     outra opção. Se o restaurante tem Orange Money, leva-o à escolha do
     pagamento; se não tem, segue directo para a confirmação. */
  useEffect(() => {
    if (!confirmarAposLogin || !paymentInfoLoaded) return;
    setConfirmarAposLogin(false);
    if (paymentInfo?.merchant_code || paymentInfo?.payment_number) {
      paymentSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      toast.info(t("businessDetail.choosePaymentNow"));
    } else {
      setOrderConfirmOpen(true);
    }
  }, [confirmarAposLogin, paymentInfoLoaded, paymentInfo, t]);

  // Silent GPS capture for delivery orders (no map shown)
  useEffect(() => {
    if (consumptionOption !== "entrega" || customerLocation) return;
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setCustomerLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => {},
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [consumptionOption]);

  // Auto-stop voice recording at 30 seconds — must be before early returns (Rules of Hooks)
  useEffect(() => {
    if (recorder.state === "recording" && recorder.duration >= 30) {
      recorder.stopRecording();
    }
  }, [recorder.state, recorder.duration]);


  // A barra desaparece enquanto se escreve. O padding do fim da pagina resolve o
  // fim do scroll, mas a meio a barra passava por cima da caixa "Deixe a sua
  // avaliacao" e do formulario do pedido — e em telemovel o teclado ainda encolhe
  // o ecra e agrava isto. Volta assim que o campo perde o foco.
  useEffect(() => {
    const isField = (el: EventTarget | null) =>
      el instanceof HTMLElement && ["INPUT", "TEXTAREA"].includes(el.tagName);
    const onFocus = (e: FocusEvent) => { if (isField(e.target)) setTyping(true); };
    const onBlur = (e: FocusEvent) => { if (isField(e.target)) setTyping(false); };
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onBlur);
    return () => {
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onBlur);
    };
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen text-muted-foreground">{t("businessDetail.loading")}</div>;
  }

  if (!business || business.profile_type !== "business") {
    return <div className="flex items-center justify-center min-h-screen text-muted-foreground">{t("businessDetail.notFound")}</div>;
  }

  const name = String(business.name ?? "");
  const phone = String(business.phone ?? "");
  const category = String(business.category ?? "");
  const location = String(business.location ?? "");
  const description = (business.description as string | null) ?? null;
  const photoUrl = (business.photo_url as string | null) ?? null;
  const isVerified = Boolean(business.is_verified);
  const consumptionOptions = ((business.consumption_options ?? []) as string[]).filter(
    (o) => ["comer_no_local", "para_levar", "entrega"].includes(o)
  );
  const avgRating = reviews.length ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10 : 0;
  const activeConsumption = consumptionOption || consumptionOptions[0] || "";
  const cartItems = menuItems.filter((i) => (cart[i.id] ?? 0) > 0);
  const cartTotal = cartItems.reduce((sum, i) => sum + i.price * (cart[i.id] ?? 0), 0);
  const cartCount = cartItems.reduce((sum, i) => sum + (cart[i.id] ?? 0), 0);


  const showCartBar = cartItems.length > 0 && !typing && !lojaFechada;

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

  const uploadVoiceNote = async (): Promise<string | null> => {
    if (!recorder.audioBlob || !user?.id) return null;
    const blob = recorder.audioBlob;
    if (blob.size === 0) return null;
    setVoiceUploading(true);
    try {
      const ext = blob.type.includes("mp4") ? "mp4" : "webm";
      // Bucket PRIVADO: a morada falada só a ouvem o cliente, o restaurante, o
      // motorista atribuído e o admin. Guarda-se o nome do objecto, não uma URL.
      const fileName = caminhoPrivado(user.id, ext);
      const { error } = await supabase.storage
        .from(BUCKET_PRIVADO.notasVoz)
        .upload(fileName, blob, { contentType: tipoSemParametros(blob.type, "audio/webm") });
      if (error) throw error;
      setVoiceNoteUrl(fileName);
      return fileName;
    } catch (err) {
      console.error("[voice] upload error:", err);
      return null;
    } finally {
      setVoiceUploading(false);
    }
  };

  const toggleVoicePlayback = () => {
    if (!recorder.audioUrl) return;
    if (!voiceAudioRef.current) {
      voiceAudioRef.current = new Audio(recorder.audioUrl);
      voiceAudioRef.current.onended = () => setVoicePlaying(false);
    }
    if (voicePlaying) {
      voiceAudioRef.current.pause();
      setVoicePlaying(false);
    } else {
      voiceAudioRef.current.play();
      setVoicePlaying(true);
    }
  };

  const uploadPaymentProof = async (file: File): Promise<string | null> => {
    if (!user?.id) return null;
    setPaymentProofUploading(true);
    try {
      // Bucket PRIVADO: só o cliente, o restaurante do pedido e o admin o abrem, e
      // só por URL assinado. Guarda-se o nome do objecto, não uma URL.
      const fileName = caminhoComprovativo(user.id, file);
      const { error } = await supabase.storage.from(COMPROVATIVOS_BUCKET).upload(fileName, file, { contentType: file.type });
      if (error) throw error;
      setPaymentProofUrl(fileName);
      setPaymentProofPreview((antiga) => {
        if (antiga) URL.revokeObjectURL(antiga);
        return URL.createObjectURL(file);
      });
      return fileName;
    } catch (err) {
      console.error("[payment] upload error:", err);
      toast.error(t("businessDetail.paymentProofError"));
      return null;
    } finally {
      setPaymentProofUploading(false);
    }
  };

  const handlePaymentProofChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast.error(t("common.imageTooLarge"));
    await uploadPaymentProof(file);
  };

  const businessMerchantCode = paymentInfo?.merchant_code ?? "";
  const businessPaymentNumber = paymentInfo?.payment_number ?? "";
  const hasOnlinePayment = !!(businessMerchantCode || businessPaymentNumber);
  // Fase 6.1: no Orange Money o restaurante recebe TUDO -- comida e entrega. Mostrar
  // só a comida fazia o cliente transferir a menos.
  const valorOrangeMoney = cartTotal + (deliveryPrice?.preco ?? 0);
  // Ponto 4: Orange Money sem comprovativo não avança. O servidor recusa na mesma
  // (create_order); isto só evita que o cliente chegue ao fim para levar um erro.
  const pagaOrangeMoney = activeConsumption === "entrega" && paymentMethod === "online";
  const faltaComprovativo = pagaOrangeMoney && !paymentProofUrl;
  const travarSemComprovativo = () => {
    if (!pagaOrangeMoney) return false;
    if (paymentProofUploading) {
      toast.info(t("businessDetail.proofStillUploading"));
      return true;
    }
    if (!paymentProofUrl) {
      toast.error(t("businessDetail.proofRequired"));
      paymentSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return true;
    }
    return false;
  };

  const sendOrder = async () => {
    if (!id) return;
    if (!cartItems.length) return toast.error(t("businessDetail.addItems"));
    // O backend recusa na mesma (§46); isto é só para não deixar o cliente
    // preencher tudo para levar com um erro no fim.
    if (lojaFechada) return toast.error("Este restaurante está fechado neste momento.");
    if (!activeConsumption) return toast.error(t("businessDetail.chooseConsumption"));
    if (activeConsumption === "entrega") {
      if (!deliveryPhone.trim()) return toast.error(t("businessDetail.enterPhone"));
      if (!bairro.trim()) return toast.error(t("businessDetail.selectBairro"));
    }
    if (travarSemComprovativo()) return;
    if (user) setOrderConfirmOpen(true);
    else requireAuth(() => setConfirmarAposLogin(true));
  };

  const confirmOrder = async () => {
    if (!id) return;
    if (!orderCustomerName.trim()) return toast.error(t("businessDetail.enterName"));
    const phoneForOrder = activeConsumption === "entrega" ? deliveryPhone.trim() : orderCustomerPhone.trim();
    if (!phoneForOrder) return toast.error(t("businessDetail.enterPhone"));
    if (travarSemComprovativo()) {
      setOrderConfirmOpen(false);
      return;
    }
    setSending(true);
    try {
      // Upload voice note if recorded
      let uploadedVoiceUrl = voiceNoteUrl;
      if (recorder.state === "recorded" && recorder.audioBlob && !voiceNoteUrl) {
        uploadedVoiceUrl = await uploadVoiceNote();
      }

      const orderId = await createOrder.mutateAsync({
        businessId: id,
        customerId: user?.id ?? null,
        customerName: orderCustomerName.trim(),
        customerPhone: phoneForOrder,
        items: cartItems.map((i) => ({ menu_item_id: i.id, name: i.name, price: i.price, qty: cart[i.id] ?? 0 })),
        total: cartTotal,
        consumptionOption: activeConsumption,
        address: activeConsumption === "entrega" ? [bairro.trim(), referencePoint.trim()].filter(Boolean).join(" - ") : undefined,
        notes: orderNotes.trim() || undefined,
        bairro: activeConsumption === "entrega" ? bairro.trim() || undefined : undefined,
        customerLat: activeConsumption === "entrega" ? customerLocation?.lat : undefined,
        customerLng: activeConsumption === "entrega" ? customerLocation?.lng : undefined,
        voiceNoteUrl: activeConsumption === "entrega" ? uploadedVoiceUrl || undefined : undefined,
        paymentMethod: activeConsumption === "entrega" ? paymentMethod : "entrega",
        paymentProofUrl: paymentMethod === "online" ? paymentProofUrl || undefined : undefined,
      });
      toast.success(t("businessDetail.orderSuccess"));
      setCart({});
      setBairro("");
      setReferencePoint("");
      setDeliveryPhone("");
      setOrderCustomerName("");
      setOrderCustomerPhone("");
      setOrderNotes("");
      preencherContacto();
      setOrderConfirmOpen(false);
      setCustomerLocation(null);
      setVoiceNoteUrl(null);
      setPaymentMethod("entrega");
      setPaymentProofUrl(null);
      setPaymentProofPreview(null);
      recorder.reset();
      voiceAudioRef.current = null;
    } catch (err) {
      console.error("[order] error:", err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg || t("businessDetail.orderError"));
    } finally {
      setSending(false);
    }
  };

  const groupedItems = (catId: string | null) => menuItems.filter((i) => i.category_id === catId);
  const uncategorized = groupedItems(null);

  const openReport = () => {
    setReportReason("");
    setReportDescription("");
    setReportContact("");
    setReportStep("form");
    setReportOpen(true);
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

  // pb-[8.5rem] enquanto a barra esta' visivel: navegacao inferior (4rem) +
  // altura da barra (3.5rem) + 1rem de margem, para nada ficar escondido por
  // baixo dela no fim do scroll sem depender do padding do Layout.
  return (
    <div className={cn("max-w-lg mx-auto px-4 pt-6", showCartBar && "pb-[8.5rem]")}>
      {/* Fase 2.5 — dizer que está fechado ANTES de a pessoa escolher a comida.
          Aparece no topo, não junto ao botão: descobrir que está fechado depois
          de encher o carrinho é a pior altura para o saber (§52). */}
      {lojaFechada && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-sm font-semibold text-destructive">Fechado neste momento</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {horario?.periodos?.length
              ? "Pode ver o menu, mas só é possível encomendar dentro do horário."
              : "Este restaurante não está a aceitar pedidos agora."}
          </p>
          {!!horario?.periodos?.length && (
            <div className="mt-2 space-y-0.5">
              {["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"].map((nome, d) => {
                const ps = horario.periodos.filter((x) => x.weekday === d);
                return (
                  <p key={d} className="text-[11px] text-muted-foreground">
                    <span className="inline-block w-16">{nome}</span>
                    {ps.length === 0
                      ? "Fechado"
                      : ps.map((x) => `${x.opens_at}–${x.closes_at}`).join(" · ")}
                  </p>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Foto de destaque. Mesmo padrão do RestaurantCard da lista — incluindo a
          máscara verde quando não há foto — para os dois ecrãs se reconhecerem
          um ao outro. É aqui e no item de menu que a fotografia se justifica (§9). */}
      <div className="relative mb-4 aspect-video w-full overflow-hidden rounded-lg bg-muted">
        {photoUrl ? (
          <img
            src={photoUrl}
            alt=""
            aria-hidden="true"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-primary-light">
            <span className="text-5xl font-bold text-primary">{name.charAt(0).toUpperCase()}</span>
          </div>
        )}
        {/* A máscara envolve o nome em vez de ter altura fixa: um nome longo
            quebra em duas ou três linhas e assim continua sempre sobre gradiente. */}
        <div
          className={cn(
            "absolute inset-x-0 bottom-0 bg-gradient-to-t pt-16",
            photoUrl ? "from-black/85 via-black/45 to-transparent" : "from-primary via-primary/60 to-transparent"
          )}
        >
          {/* Sem foto o fundo é laranja, e o texto é preto: branco dava 2.61:1. */}
          <h1 className={cn("flex items-end gap-1.5 p-4 text-display", photoUrl ? "text-white drop-shadow-sm" : "text-primary-foreground")}>
            <span className="min-w-0 break-words">{name}</span>
            {isVerified && (
              <BadgeCheck className="mb-1 h-6 w-6 shrink-0" aria-label={t("businessDetailExtra.verifiedLabel")} />
            )}
          </h1>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* Chip neutro. Antes era um badge âmbar, cor que o sistema (§3) reserva
            para "pendente/à espera" — numa categoria estática parecia um aviso. */}
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-light px-3 py-1.5 text-caption text-primary">
          <Store className="h-4 w-4" aria-hidden="true" />
          {translateCategoryName(category, bizCats as { id: string; name: string; name_en: string | null; name_fr: string | null }[], i18n.language)}
        </span>
        {reviews.length > 0 && (
          <div className="flex items-center gap-2">
            <StarRating rating={Math.round(avgRating)} size="md" />
            <span className="text-caption text-muted-foreground">
              {avgRating.toFixed(1)} ({reviews.length})
            </span>
          </div>
        )}
      </div>

      {/* Informação prática agrupada num bloco só, em vez de linhas soltas. */}
      <div className="mb-6 rounded-lg bg-muted p-4 space-y-3">
        <div className="flex items-center gap-3 text-body">
          <MapPin className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 break-words">{location}</span>
        </div>
        <div className="flex items-center gap-3 text-body">
          <Phone className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <a href={`tel:${phone.replace(/\s/g, "")}`} className="min-w-0 break-words" onClick={() => trackCall()}>
            {phone}
          </a>
        </div>
        {consumptionOptions.length > 0 && (
          <div className="flex items-start gap-3">
            <UtensilsCrossed className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="flex flex-wrap gap-1.5">
              {consumptionOptions.map((o) => (
                <span key={o} className="rounded-full bg-card px-2.5 py-1 text-caption text-foreground">
                  {t(CONSUMPTION_LABEL_KEYS[o] ?? o)}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {description && (
        <div className="mb-6">
          <h2 className="font-semibold mb-1">{t("businessDetail.about")}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      )}

      {menuItems.length > 0 && (
        <div className="mb-6">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <UtensilsCrossed className="h-5 w-5 text-primary" /> {t("businessDetail.menu")}
          </h2>
          <div className="flex flex-col gap-4">
            {menuCategories.map((cat) => {
              const items = groupedItems(cat.id);
              if (!items.length) return null;
              return (
                <div key={cat.id}>
                  <h3 className="mb-2 border-b pb-1 text-caption font-semibold text-primary">{cat.name}</h3>
                  <div className="flex flex-col gap-3">
                    {items.map((item) => (
                      <MenuItemRow key={item.id} item={item} category={cat.name} qty={cart[item.id] ?? 0} onAdd={() => addToCart(item.id)} onRemove={() => removeFromCart(item.id)} />
                    ))}
                  </div>
                </div>
              );
            })}
            {uncategorized.length > 0 && (
              <div>
                <h3 className="mb-2 border-b pb-1 text-caption font-semibold text-primary">{t("businessDetail.others")}</h3>
                <div className="flex flex-col gap-3">
                  {uncategorized.map((item) => (
                    <MenuItemRow key={item.id} item={item} category={t("businessDetail.others")} qty={cart[item.id] ?? 0} onAdd={() => addToCart(item.id)} onRemove={() => removeFromCart(item.id)} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {cartItems.length > 0 && (
        <Card ref={cartRef} className="mb-6 border-primary/40 scroll-mt-20">
          <CardContent className="p-4">
            <h2 className="font-semibold mb-2 flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-primary" /> {t("businessDetail.orderTitle", { count: cartCount })}
            </h2>
            <div className="flex flex-col gap-1.5 mb-3">
              {cartItems.map((i) => (
                <div key={i.id} className="flex items-center justify-between text-sm">
                  <span className="min-w-0 truncate">{i.name} x{cart[i.id]}</span>
                  <span className="font-medium shrink-0">{formatCFA(i.price * (cart[i.id] ?? 0))}</span>
                </div>
              ))}
              <div className="flex items-center justify-between text-sm font-bold border-t pt-1.5">
                <span>{t("businessDetail.estimatedTotal")}</span>
                <span>{formatCFA(cartTotal)}</span>
              </div>
            </div>

            {consumptionOptions.length > 0 && (
              <div className="mb-3">
                <Label className="text-xs">{t("businessDetail.consumptionOption")}</Label>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {consumptionOptions.map((o) => (
                    <Badge
                      key={o}
                      variant={activeConsumption === o ? "default" : "outline"}
                      className="cursor-pointer px-3 py-1.5 text-xs"
                      onClick={() => setConsumptionOption(o)}
                    >
                      {t(CONSUMPTION_LABEL_KEYS[o] ?? o)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {activeConsumption === "entrega" && (
              <>
                <div className="mb-3">
                  <Label htmlFor="order-delivery-phone">{t("businessDetail.customerPhone")} *</Label>
                  <PhoneInput
                    id="order-delivery-phone"
                    placeholder={t("businessDetail.phonePlaceholder")}
                    value={deliveryPhone}
                    onChange={(e) => setDeliveryPhone(e.target.value)}
                    wrapperClassName="mt-1.5"
                  />
                </div>
                <div className="mb-3">
                  <Label>{t("businessDetail.bairro")} *</Label>
                  <Select value={bairro} onValueChange={setBairro}>
                    <SelectTrigger className="mt-1.5">
                      <SelectValue placeholder={t("businessDetail.selectBairro")} />
                    </SelectTrigger>
                    <SelectContent>
                      {bairros.map((b) => (
                        <SelectItem key={b} value={b}>{b}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="mb-3">
                  <Label htmlFor="order-reference">{t("businessDetail.referencePoint")}</Label>
                  <Input
                    id="order-reference"
                    placeholder={t("businessDetail.referencePlaceholder")}
                    value={referencePoint}
                    onChange={(e) => setReferencePoint(e.target.value)}
                    className="mt-1.5"
                  />
                </div>
                {/* Voice note for delivery directions — product decision: voice replaces map in Bissau context */}
                <div className="mb-3 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 p-3">
                  <Label className="text-xs font-semibold text-primary">
                    {t("businessDetail.voiceNoteLabel")}
                  </Label>
                  <p className="text-[11px] text-muted-foreground mt-0.5 mb-2">
                    {t("businessDetail.voiceNoteHint")}
                  </p>
                  {recorder.state === "idle" && !voiceNoteUrl && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={recorder.startRecording}
                      className="w-full gap-2 min-h-12 text-sm font-semibold border-primary/40"
                    >
                      <Mic className="h-5 w-5 text-primary" />
                      {t("businessDetail.voiceRecord")}
                    </Button>
                  )}
                  {recorder.state === "recording" && (
                    <div className="flex items-center gap-3">
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        onClick={recorder.stopRecording}
                        className="h-12 w-12 rounded-full shrink-0"
                      >
                        <Square className="h-5 w-5" />
                      </Button>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full bg-primary animate-pulse" />
                          <span className="text-sm font-bold">{formatDuration(recorder.duration)}</span>
                          <span className="text-xs text-muted-foreground">/ 0:30</span>
                        </div>
                        <div className="h-1 bg-muted rounded-full mt-1 overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${Math.min(100, (recorder.duration / 30) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                  {(recorder.state === "recorded" || voiceNoteUrl) && (
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={toggleVoicePlayback}
                        className="h-10 w-10 rounded-full shrink-0"
                      >
                        {voicePlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      </Button>
                      <div className="flex-1">
                        <span className="text-sm font-medium">{t("businessDetail.voiceRecorded")}</span>
                        <span className="text-xs text-muted-foreground ml-2">{formatDuration(recorder.duration)}</span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          recorder.reset();
                          setVoiceNoteUrl(null);
                          voiceAudioRef.current = null;
                          setVoicePlaying(false);
                        }}
                        className="gap-1 text-xs"
                      >
                        <RotateCcw className="h-3.5 w-3.5" /> {t("businessDetail.voiceRerecord")}
                      </Button>
                    </div>
                  )}
                </div>

                {/* Pagamento (§22, §23). Duas escolhas grandes, lado a lado em
                    importância. Quando o restaurante tem Orange Money, o código
                    está SEMPRE à vista dentro do cartão -- não aparece só depois
                    de escolher a opção. Tocar no código também escolhe Orange
                    Money, para ninguém pagar e deixar o pedido em "na entrega". */}
                <div ref={paymentSectionRef} className="mb-3 space-y-2" role="radiogroup" aria-label={t("businessDetail.paymentMethod")}>
                  <Label className="text-sm font-semibold">{t("businessDetail.paymentMethod")}</Label>

                  <button
                    type="button"
                    role="radio"
                    aria-checked={paymentMethod === "entrega"}
                    onClick={() => setPaymentMethod("entrega")}
                    className={cn(
                      "w-full flex items-center gap-3 rounded-xl border-2 p-3 text-left transition-colors",
                      paymentMethod === "entrega" ? "border-primary bg-primary/5" : "border-border bg-background",
                    )}
                  >
                    <span className={cn("h-5 w-5 shrink-0 rounded-full border-2 flex items-center justify-center", paymentMethod === "entrega" ? "border-primary" : "border-muted-foreground/40")}>
                      {paymentMethod === "entrega" && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
                    </span>
                    <Banknote className="h-5 w-5 shrink-0 text-primary" />
                    <span className="font-medium">{t("businessDetail.payOnDelivery")}</span>
                  </button>

                  {hasOnlinePayment && (
                    <div
                      className={cn(
                        "rounded-xl border-2 p-3 space-y-2 transition-colors",
                        paymentMethod === "online"
                          ? "border-orange-500 bg-orange-50 dark:bg-orange-950"
                          : "border-orange-200 bg-background dark:border-orange-800",
                      )}
                    >
                      <button
                        type="button"
                        role="radio"
                        aria-checked={paymentMethod === "online"}
                        onClick={() => setPaymentMethod("online")}
                        className="w-full flex items-center gap-3 text-left"
                      >
                        <span className={cn("h-5 w-5 shrink-0 rounded-full border-2 flex items-center justify-center", paymentMethod === "online" ? "border-orange-600" : "border-muted-foreground/40")}>
                          {paymentMethod === "online" && <span className="h-2.5 w-2.5 rounded-full bg-orange-600" />}
                        </span>
                        <CreditCard className="h-5 w-5 shrink-0 text-orange-600" />
                        <span className="font-medium">{t("businessDetail.payNow")}</span>
                      </button>

                      <p className="text-sm">
                        {t("businessDetail.amountToTransfer")}{" "}
                        <strong className="text-orange-800 dark:text-orange-200">{formatCFA(valorOrangeMoney)}</strong>
                      </p>

                      {/* Merchant USSD code — preferred */}
                      {businessMerchantCode && (
                        <div className="space-y-1.5">
                          <a
                            href={`tel:${businessMerchantCode.replace(/#/g, "%23")}`}
                            onClick={() => setPaymentMethod("online")}
                            className="flex items-center justify-center gap-2 w-full rounded-lg bg-orange-600 hover:bg-orange-700 text-white font-bold text-lg py-3 px-4 transition-colors"
                          >
                            <Phone className="h-5 w-5" />
                            {businessMerchantCode}
                          </a>
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] text-muted-foreground">{t("businessDetail.tapToPayUssd")}</span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="gap-1 text-xs h-6"
                              onClick={() => {
                                navigator.clipboard.writeText(businessMerchantCode);
                                toast.success(t("businessDetail.codeCopied"));
                              }}
                            >
                              <Copy className="h-3 w-3" /> {t("businessDetail.copyCode")}
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Número normal (o restaurante escolheu "número"): não há USSD para
                          abrir, a acção é COPIAR. O botão grande é o de copiar, e copiar
                          também escolhe Orange Money, como tocar no código. */}
                      {!businessMerchantCode && businessPaymentNumber && (
                        <div className="space-y-1.5">
                          <p className="text-center text-2xl font-bold tracking-wide">{businessPaymentNumber}</p>
                          <button
                            type="button"
                            onClick={() => {
                              setPaymentMethod("online");
                              void navigator.clipboard?.writeText(businessPaymentNumber);
                              toast.success(t("businessDetail.numberCopied"));
                            }}
                            className="flex items-center justify-center gap-2 w-full rounded-lg bg-orange-600 hover:bg-orange-700 text-white font-bold text-lg py-3 px-4 transition-colors"
                          >
                            <Copy className="h-5 w-5" />
                            {t("businessDetail.copyNumber")}
                          </button>
                        </div>
                      )}

                      {paymentMethod === "online" && (
                        <>
                          <p className="text-[11px] text-muted-foreground">
                            {businessMerchantCode ? t("businessDetail.paymentInstructions") : t("businessDetail.paymentInstructionsNumber")}
                          </p>

                          {/* Proof upload */}
                          <input
                            ref={paymentProofRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handlePaymentProofChange}
                          />
                          {paymentProofUrl ? (
                            <div className="flex items-center gap-2">
                              {/* A miniatura deixa ver que é a imagem certa, sem ter de confiar num "anexado". */}
                              {paymentProofPreview && (
                                <img src={paymentProofPreview} alt="" className="h-12 w-12 rounded-md border object-cover" />
                              )}
                              <Check className="h-4 w-4 text-success" />
                              <span className="text-sm text-success-foreground font-medium">{t("businessDetail.proofAttached")}</span>
                              <Button type="button" variant="ghost" size="sm" className="text-xs ml-auto" onClick={() => {
                                // Ainda não está ligado a pedido nenhum, portanto o servidor deixa
                                // apagar: não fica lixo privado de um comprovativo que se trocou.
                                if (paymentProofUrl) void supabase.storage.from(COMPROVATIVOS_BUCKET).remove([paymentProofUrl]);
                                setPaymentProofUrl(null);
                                setPaymentProofPreview(null);
                                if (paymentProofRef.current) paymentProofRef.current.value = "";
                              }}>
                                {t("businessDetail.changeProof")}
                              </Button>
                            </div>
                          ) : (
                            <div className="space-y-1.5">
                              <Button
                                type="button"
                                variant="outline"
                                className="w-full h-12 gap-2 border-2 border-orange-400 text-base"
                                onClick={() => paymentProofRef.current?.click()}
                                disabled={paymentProofUploading}
                              >
                                {paymentProofUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                                {t("businessDetail.attachProofRequired")}
                              </Button>
                              <p className="text-xs font-medium text-orange-800 dark:text-orange-200">
                                {t("businessDetail.proofRequiredHint")}
                              </p>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            <Button onClick={sendOrder} disabled={sending} className="w-full gap-2">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
              {sending ? t("businessDetail.registering") : t("businessDetail.placeOrder")}
            </Button>
            <p className="text-[11px] text-muted-foreground text-center mt-2">
              {t("businessDetail.orderHint")}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="mb-8 space-y-2">
        {/* Ligar e' accao secundaria de quem ja' escolheu o restaurante, nao a
            accao principal de quem esta' a escolher. outline e nao secondary:
            --secondary e' ambar, cor que o sistema (§3) reserva para
            "pendente/a espera". */}
        <a href={`tel:${phone.replace(/\s/g, "")}`} className="block" onClick={() => trackCall()}>
          <Button variant="outline" className="h-12 w-full gap-2 bg-card">
            <Phone className="h-5 w-5" />
            {t("common.call")}
          </Button>
        </a>

        {/* Denunciar e' uma accao rara: link discreto, nao um botao com o mesmo
            peso visual de Ligar. */}
        {!isOwnProfile && (
          <button
            type="button"
            onClick={openReport}
            className="mx-auto mt-4 flex items-center gap-1.5 rounded-md px-3 py-2 text-caption text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            {t("businessDetail.report")}
          </button>
        )}
      </div>

      <section>
        <h2 className="font-semibold mb-3">{t("businessDetail.reviewsCount", { count: reviews.length })}</h2>

        {/* O formulario aberto SAIU (Fase 9.4, decisao do dono): avalia-se a partir
            de um pedido concluido, no ecra dos pedidos. Enquanto existisse, o
            caminho antigo (sem pedido, anonimo) tornava o novo decorativo. */}
        <p className="text-xs text-muted-foreground mb-4">{t("businessDetail.rateFromOrder")}</p>

        {reviews.length > 0 ? (
          <div className="flex flex-col gap-3">
            {reviews.map((r, i) => (
              <div key={`${r.created_at}-${i}`} className="p-3 rounded-lg border bg-card">
                <StarRating rating={r.rating} />
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
                  <CheckCircle2 className="h-5 w-5 text-success" />
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

      {/* Order Confirmation Dialog */}
      <Dialog open={orderConfirmOpen} onOpenChange={setOrderConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("businessDetail.confirmOrder")}</DialogTitle>
            <DialogDescription>{t("businessDetail.confirmOrderDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="rounded-lg border bg-muted/50 p-3 text-sm">
              {cartItems.map((i) => (
                <div key={i.id} className="flex justify-between">
                  <span>{i.name} x{i.id ? cart[i.id] : 0}</span>
                  <span className="font-medium">{formatCFA(i.price * (cart[i.id] ?? 0))}</span>
                </div>
              ))}
              {activeConsumption === "entrega" ? (
                <>
                  <div className="flex justify-between border-t mt-1.5 pt-1.5">
                    <span className="text-muted-foreground">{t("businessDetail.total")}</span>
                    <span>{formatCFA(cartTotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Taxa de entrega</span>
                    <span>
                      {!bairro
                        ? "—"
                        : deliveryPriceLoading
                          ? "…"
                          : deliveryPrice
                            ? formatCFA(deliveryPrice.preco)
                            : "sem entrega"}
                    </span>
                  </div>
                  <div className="flex justify-between font-bold border-t mt-1.5 pt-1.5">
                    <span>Total a pagar</span>
                    <span>{formatCFA(cartTotal + (deliveryPrice?.preco ?? 0))}</span>
                  </div>
                  {bairro && !deliveryPriceLoading && !deliveryPrice && (
                    <p className="text-xs text-muted-foreground mt-1.5">
                      Nenhuma frota entrega em {bairro} de momento. O pedido pode
                      ser feito, mas não será atribuído a um motorista.
                    </p>
                  )}
                </>
              ) : (
                <div className="flex justify-between font-bold border-t mt-1.5 pt-1.5">
                  <span>{t("businessDetail.total")}</span>
                  <span>{formatCFA(cartTotal)}</span>
                </div>
              )}
            </div>

            {activeConsumption === "entrega" && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950 p-3 text-sm space-y-1">
                <p className="font-semibold text-blue-700 dark:text-blue-300 text-xs uppercase">{t("businessDetail.deliveryInfo")}</p>
                <p><span className="text-muted-foreground">{t("businessDetail.bairro")}:</span> <strong>{bairro}</strong></p>
                <p>
                  <span className="text-muted-foreground">{t("businessDetail.paymentMethod")}:</span>{" "}
                  <strong>{paymentMethod === "online" ? t("businessDetail.payNow") : t("businessDetail.payOnDelivery")}</strong>
                </p>
                {referencePoint && <p><span className="text-muted-foreground">{t("businessDetail.referencePoint")}:</span> {referencePoint}</p>}
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="order-name">{t("businessDetail.customerName")}</Label>
              <Input
                id="order-name"
                placeholder={t("businessDetail.recipientNamePlaceholder")}
                value={orderCustomerName}
                onChange={(e) => setOrderCustomerName(e.target.value)}
              />
            </div>
            {/* Na entrega é o mesmo campo da página: mudá-lo aqui muda o
                telefone que o motorista vai usar. */}
            <div className="grid gap-2">
              <Label htmlFor="order-phone">{t("businessDetail.customerPhone")}</Label>
              <PhoneInput
                id="order-phone"
                placeholder={t("businessDetail.phonePlaceholder")}
                value={activeConsumption === "entrega" ? deliveryPhone : orderCustomerPhone}
                onChange={(e) =>
                  activeConsumption === "entrega" ? setDeliveryPhone(e.target.value) : setOrderCustomerPhone(e.target.value)
                }
              />
              <p className="text-xs text-muted-foreground">{t("businessDetail.otherRecipientHint")}</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="order-notes">{t("businessDetail.orderNotes")}</Label>
              <Textarea
                id="order-notes"
                placeholder={t("businessDetail.orderNotesPlaceholder")}
                value={orderNotes}
                onChange={(e) => setOrderNotes(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOrderConfirmOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={confirmOrder}
              disabled={sending || faltaComprovativo || !orderCustomerName.trim() || !(activeConsumption === "entrega" ? deliveryPhone : orderCustomerPhone).trim()}
              className="gap-2 min-h-12"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {sending ? t("businessDetail.registering") : t("businessDetail.confirmOrder")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ClientSignupDialog open={signupOpen} onOpenChange={setSignupOpen} onSuccess={onSignupSuccess} />

      {/* Resumo do carrinho, fixo assim que ha' um item: o formulario do pedido
          e' longo (entrega, nota de voz, pagamento) e sem isto era preciso
          descer a pagina toda para saber quanto ja' se gastou.
          Assenta por cima da navegacao inferior (4rem) e do indicador de ecra. */}
      {showCartBar && (
        <div
          className="fixed inset-x-0 z-40 px-4"
          style={{ bottom: "calc(4rem + env(safe-area-inset-bottom))" }}
        >
          <button
            type="button"
            onClick={() => cartRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="mx-auto flex h-14 w-full max-w-lg items-center justify-between gap-3 rounded-lg bg-primary px-4 text-primary-foreground shadow-elevated transition-transform active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <span className="relative flex shrink-0 items-center">
              <ShoppingCart className="h-6 w-6" aria-hidden="true" />
              <span className="absolute -right-2 -top-2 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-primary-foreground px-1 text-caption font-bold text-primary-on-dark">
                {cartCount}
              </span>
            </span>
            <span className="min-w-0 truncate text-body font-semibold">{t("businessDetail.viewCart")}</span>
            <span className="shrink-0 text-price">{formatCFA(cartTotal)}</span>
          </button>
        </div>
      )}
    </div>
  );
};

/** Cartão de produto: fundo branco, imagem arredondada, nome + categoria +
 *  preço, e o "+" laranja circular no canto (marca iTudoo). */
const MenuItemRow = ({ item, category, qty, onAdd, onRemove }: { item: MenuItem; category: string; qty: number; onAdd: () => void; onRemove: () => void }) => {
  const { t } = useTranslation();
  return (
  <div className="flex items-center gap-3 rounded-xl border bg-card p-3 shadow-card">
    {item.photo_url ? (
      <ImagePreviewModal src={item.photo_url} alt={item.name} />
    ) : (
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden="true">
        <UtensilsCrossed className="h-5 w-5" />
      </div>
    )}
    <div className="min-w-0 flex-1">
      <div className="text-body font-semibold">{item.name}</div>
      <div className="truncate text-caption text-muted-foreground">{category}</div>
      <div className="text-price">{formatCFA(item.price)}</div>
      {/* §83, não surpreender: o cliente vê que acabou antes de tentar, em vez
          de levar com o erro do servidor depois de encher o carrinho. A recusa
          continua a existir no servidor — isto é só cortesia de interface. */}
      {!item.is_orderable ? (
        <div className="text-xs font-medium text-destructive">{t("businessDetail.soldOut")}</div>
      ) : item.track_stock && item.stock_qty !== null && item.stock_qty <= 5 ? (
        <div className="text-xs text-muted-foreground">
          {t("businessDetail.stockLeft", { count: item.stock_qty })}
        </div>
      ) : null}
    </div>
    {/* 44px: e' o controlo mais usado da pagina e o minimo do plano (§5.2).
        Estava a 32px. */}
    {!item.is_orderable ? (
      <Button variant="outline" className="h-11 shrink-0 px-4" disabled>
        {t("businessDetail.soldOut")}
      </Button>
    ) : qty === 0 ? (
      <Button size="icon" className="h-11 w-11 shrink-0 rounded-full" onClick={onAdd} aria-label={`${t("common.add")} ${item.name}`}>
        <Plus className="h-5 w-5" />
      </Button>
    ) : (
      <div className="flex shrink-0 items-center gap-1">
        <Button size="icon" variant="outline" className="h-11 w-11 rounded-full" onClick={onRemove}>
          <Minus className="h-4 w-4" />
        </Button>
        <span className="w-7 text-center text-body font-semibold">{qty}</span>
        <Button
          size="icon"
          className="h-11 w-11 rounded-full"
          onClick={onAdd}
          disabled={item.track_stock && item.stock_qty !== null && qty >= item.stock_qty}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    )}
  </div>
  );
};

export default BusinessDetail;
