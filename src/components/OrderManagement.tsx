import { useState, useEffect } from "react";
import {
  Package,
  CheckCircle2,
  ChefHat,
  UtensilsCrossed,
  Timer,
  XCircle,
  Copy,
  Check,
  Truck,
  MapPin,
  Phone,
  Volume2,
  CreditCard,
  Inbox,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBusinessOrders, useUpdateOrderStatus, useValidateOrderPayment, type Order } from "@/hooks/useOrders";
import { orderStatusTone, paymentStatusTone, TONE_SOFT, TONE_STRONG } from "@/lib/orderStatus";
import { useTranslation } from "react-i18next";
import { formatCFA } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RESTAURANT_PANEL_STEPS } from "@/lib/orderTransitions";

const DELIVERY_IN_PROGRESS_STATUSES = [
  "aguardando_motorista",
  "motorista_encontrado",
  "pedido_recolhido",
  "a_caminho",
];

const STATUS_TABS = [
  { value: "novo", label: "orderStatus.novo", icon: Package },
  { value: "confirmado", label: "orderStatus.confirmado", icon: CheckCircle2 },
  { value: "em_preparacao", label: "orderStatus.em_preparacao", icon: ChefHat },
  { value: "pronto", label: "orderStatus.pronto", icon: UtensilsCrossed },
  { value: "em_entrega", label: "orderStatus.em_entrega", icon: Truck },
  // Era `entregue`. Depois da fusao da Fase 1 esse filtro nunca encontrava
  // nada e os pedidos concluidos ficavam invisiveis ao restaurante.
  { value: "concluido", label: "orderStatus.concluido", icon: CheckCircle2 },
  { value: "cancelado", label: "orderStatus.cancelado", icon: XCircle },
];

// A tabela do painel vive agora em @/lib/orderTransitions, ao lado da matriz
// que espelha o servidor, e ha um teste que garante que uma e subconjunto da
// outra. Aqui ficava uma copia solta que ainda apontava para `entregue` --
// estado fundido em `concluido` na Fase 1 -- e que por isso oferecia ao
// restaurante um botao que o servidor ja recusava.

// Chaves de tradução, não texto fixo: antes eram emoji + português no código,
// o que deixava esta parte por traduzir e o emoji saía partido em alguns
// sistemas. São as mesmas chaves que a página do restaurante já usa.
const CONSUMPTION_LABEL_KEYS: Record<string, string> = {
  comer_no_local: "businessDetail.consumption.eatIn",
  para_levar: "businessDetail.consumption.takeAway",
  entrega: "businessDetail.consumption.delivery",
};

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Badge de estado. Cor + texto: a cor nunca vai sozinha (§3). */
const StatusBadge = ({ status, className }: { status: string; className?: string }) => {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-caption",
        TONE_SOFT[orderStatusTone(status)],
        className
      )}
    >
      {t(`orderStatus.${status}`, status)}
    </span>
  );
};

const PaymentBadge = ({ status }: { status: string | null | undefined }) => {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-caption",
        TONE_SOFT[paymentStatusTone(status)]
      )}
    >
      {t(`orderManagement.paymentStatus_${status}`, status ?? "")}
    </span>
  );
};

interface CopyButtonProps {
  text: string;
  label: string;
}

const CopyButton = ({ text, label }: CopyButtonProps) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleCopy}
      className="h-9 shrink-0 gap-1 px-2 text-caption"
    >
      {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
      {label}
    </Button>
  );
};

/** Leitor da indicação de morada gravada pelo cliente. */
const VoiceNote = ({ url, customerName }: { url: string; customerName: string | null }) => {
  const { t } = useTranslation();
  return (
    <div className="rounded-md bg-pending-soft px-3 py-2">
      <p className="mb-1 flex items-center gap-1.5 text-caption text-pending-foreground">
        <Volume2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        {t("orderManagement.voiceDirectionFrom", { name: customerName ?? t("orderManagement.voiceDirection") })}
      </p>
      <audio src={url} controls className="h-9 w-full min-w-0" />
    </div>
  );
};

interface OrderManagementProps {
  businessId: string;
}

const OrderManagement = ({ businessId }: OrderManagementProps) => {
  const { t } = useTranslation();
  const { data: allOrders = [], isLoading, refetch } = useBusinessOrders(businessId);
  const updateStatus = useUpdateOrderStatus();
  const validatePayment = useValidateOrderPayment();
  const [activeTab, setActiveTab] = useState("novo");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [proofPreviewUrl, setProofPreviewUrl] = useState<string | null>(null);
  const [prepTimeDialogOpen, setPrepTimeDialogOpen] = useState(false);
  const [prepTimeInput, setPrepTimeInput] = useState("");
  const [pendingStatus, setPendingStatus] = useState("");

  useEffect(() => {
    const interval = setInterval(() => refetch(), 10000);
    return () => clearInterval(interval);
  }, [refetch]);

  const getOrdersByStatus = (status: string) =>
    status === "em_entrega"
      ? allOrders.filter((o) => DELIVERY_IN_PROGRESS_STATUSES.includes(o.status))
      : allOrders.filter((o) => o.status === status);

  // O pedido escolhido vem sempre da lista actual, para o painel lateral não
  // ficar preso a uma cópia velha quando o estado muda por baixo (a lista
  // recarrega de 10 em 10 segundos).
  const selected = selectedOrder ? allOrders.find((o) => o.id === selectedOrder.id) ?? null : null;

  const openOrder = (order: Order) => {
    setSelectedOrder(order);
    setDetailOpen(true);
  };

  const handleStatusChange = async (orderId: string, newStatus: string) => {
    if (newStatus === "em_preparacao") {
      setSelectedOrder(allOrders.find((o) => o.id === orderId) ?? null);
      setPendingStatus(newStatus);
      setPrepTimeInput("");
      setPrepTimeDialogOpen(true);
      return;
    }
    try {
      await updateStatus.mutateAsync({ orderId, newStatus });
    } catch (err) {
      console.error("[order] status update error:", err);
    }
  };

  const confirmPrepTime = async () => {
    if (!selectedOrder) return;
    const time = parseInt(prepTimeInput) || 30;
    try {
      await updateStatus.mutateAsync({
        orderId: selectedOrder.id,
        newStatus: pendingStatus,
        preparationTime: time,
      });
      setPrepTimeDialogOpen(false);
      setSelectedOrder(null);
    } catch (err) {
      console.error("[order] status update error:", err);
    }
  };

  const detailFor = (order: Order) => (
    <OrderDetail
      order={order}
      onPreviewProof={setProofPreviewUrl}
      onValidatePayment={(status) => validatePayment.mutate({ orderId: order.id, status })}
      validating={validatePayment.isPending}
    />
  );

  // A accao que faz avancar o pedido e' a principal; cancelar e' rara e fica
  // discreta ao lado de "Ver" (§5.5: uma accao principal larga, em baixo).
  const nextSteps = (order: Order) => RESTAURANT_PANEL_STEPS[order.status] ?? [];

  const statusActions = (order: Order, onBefore?: () => void) => {
    const steps = nextSteps(order);
    const avancar = steps.find((s) => s !== "cancelado");
    const podeCancelar = steps.includes("cancelado");
    const agir = (newStatus: string) => {
      onBefore?.();
      handleStatusChange(order.id, newStatus);
    };
    return { avancar, podeCancelar, agir };
  };

  return (
    <div>
      <Tabs
        value={activeTab}
        onValueChange={(v) => {
          setActiveTab(v);
          setSelectedOrder(null);
        }}
      >
        <TabsList className="grid h-auto w-full grid-cols-3 gap-1 bg-muted/50 p-1 sm:grid-cols-4 lg:grid-cols-7">
          {STATUS_TABS.map((tab) => {
            const count = getOrdersByStatus(tab.value).length;
            const Icon = tab.icon;
            return (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="flex min-h-14 flex-col items-center gap-0.5 px-1 py-2 text-caption data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                <Icon className={cn("h-4 w-4", TONE_STRONG[orderStatusTone(tab.value)])} aria-hidden="true" />
                <span className="text-center leading-tight">
                  {t(`orderManagement.tab.${tab.value}`, t(tab.label))}
                  {count > 0 && <span className="font-bold"> ({count})</span>}
                </span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {STATUS_TABS.map((tab) => {
          const orders = getOrdersByStatus(tab.value);
          return (
            <TabsContent key={tab.value} value={tab.value}>
              {isLoading ? (
                <div className="mt-3 flex flex-col gap-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <OrderCardSkeleton key={i} />
                  ))}
                </div>
              ) : orders.length === 0 ? (
                <div className="flex flex-col items-center px-6 py-12 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                    <Inbox className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
                  </div>
                  <p className="mt-4 text-body text-muted-foreground">
                    {t(`orderManagement.empty.${tab.value}`, t("orderManagement.noOrders"))}
                  </p>
                </div>
              ) : (
                // Uma coluna. Em ecrã largo os cartões continuam compactos e
                // repartem-se por colunas, para o espaço não ficar vazio — mas
                // sem painel de detalhe fixo ao lado: o detalhe é sempre modal,
                // igual em telemóvel e em computador.
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {orders.map((order) => (
                    <OrderCard key={order.id} order={order} onOpen={() => openOrder(order)} />
                  ))}
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>

      {/* Detalhe completo em diálogo, em qualquer tamanho de ecrã. */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        {/* [&>*]:min-w-0 — o DialogContent do shadcn e' uma grelha, e os filhos com
            min-width:auto faziam a faixa crescer ate' ao conteudo mais largo (o
            leitor de audio), empurrando tudo para fora do ecra em telemovel. */}
        <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto [&>*]:min-w-0 sm:w-full sm:max-w-lg">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-title">
                  #{selected.order_number}
                  <StatusBadge status={selected.status} />
                </DialogTitle>
                <DialogDescription>{new Date(selected.created_at).toLocaleString()}</DialogDescription>
              </DialogHeader>

              {detailFor(selected)}

              <DialogFooter className="sm:flex-col sm:space-x-0">
                <OrderActions
                  {...statusActions(selected, () => setDetailOpen(false))}
                  pending={updateStatus.isPending}
                />
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Payment proof preview */}
      <Dialog open={!!proofPreviewUrl} onOpenChange={(o) => { if (!o) setProofPreviewUrl(null); }}>
        <DialogContent className="w-auto max-w-[90vw] border-0 bg-transparent p-0 shadow-none">
          {proofPreviewUrl && (
            <img src={proofPreviewUrl} alt={t("orderManagement.paymentProof")} className="mx-auto max-h-[80vh] max-w-full rounded-lg object-contain" />
          )}
        </DialogContent>
      </Dialog>

      {/* Prep Time Dialog */}
      <Dialog open={prepTimeDialogOpen} onOpenChange={setPrepTimeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("orderManagement.prepTimeTitle")}</DialogTitle>
            <DialogDescription>{t("orderManagement.prepTimeDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="prep-time">{t("orderManagement.prepTimeMinutes")}</Label>
              <Input
                id="prep-time"
                type="number"
                min="5"
                max="180"
                placeholder="30"
                value={prepTimeInput}
                onChange={(e) => setPrepTimeInput(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrepTimeDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={confirmPrepTime} disabled={updateStatus.isPending} className="gap-2">
              <Timer className="h-4 w-4" />
              {t("common.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

/**
 * Accoes de um pedido. A que o faz avancar e' a principal — larga, em baixo.
 * Cancelar e' raro: fica discreto, sem competir com ela (§5.5).
 */
const OrderActions = ({
  avancar,
  podeCancelar,
  agir,
  pending,
}: {
  avancar?: string;
  podeCancelar: boolean;
  agir: (status: string) => void;
  pending: boolean;
}) => {
  const { t } = useTranslation();

  return (
    <div className="w-full space-y-2">
      {avancar && (
        <Button
          onClick={() => agir(avancar)}
          disabled={pending}
          className="h-14 w-full text-body font-semibold"
        >
          {t(`orderManagement.advanceTo.${avancar}`, t(`orderStatus.${avancar}`, avancar))}
        </Button>
      )}
      {podeCancelar && (
        <Button
          variant="ghost"
          onClick={() => agir("cancelado")}
          disabled={pending}
          className="h-11 w-full text-body text-destructive hover:text-destructive"
        >
          {t("common.cancel")}
        </Button>
      )}
    </div>
  );
};

const OrderCardSkeleton = () => (
  <Card>
    <CardContent className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-6 w-20" />
      </div>
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-12 w-full" />
    </CardContent>
  </Card>
);

/**
 * Cartão da lista. Só o que serve para decidir se vale a pena abrir — sem
 * botões de acção: essas vivem todas dentro do modal de detalhe.
 */
const OrderCard = ({ order, onOpen }: { order: Order; onOpen: () => void }) => {
  const { t } = useTranslation();

  const consumo = t(CONSUMPTION_LABEL_KEYS[order.consumption_option] ?? "", order.consumption_option);
  const resumo =
    order.items.length === 1
      ? `${order.items[0].name} x${order.items[0].qty}`
      : t("orderManagement.itemCount", { count: order.items.length });

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col items-stretch justify-start rounded-lg border bg-card p-4 text-left shadow-soft transition-all hover:shadow-elevated active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-title">#{order.order_number}</p>
          <p className="text-caption text-muted-foreground">{hora(order.created_at)}</p>
        </div>
        <p className="shrink-0 text-price text-primary">{formatCFA(order.total)}</p>
      </div>

      <div className="mt-2">
        <StatusBadge status={order.status} />
      </div>

      {/* Cliente e tipo de consumo: informação, não estado — sem badge próprio,
          para não competir com o único badge que indica o estado do pedido. */}
      <p className="mt-2 truncate text-body">
        {order.customer_name}
        <span className="text-muted-foreground"> · {consumo}</span>
      </p>

      <p className="mt-0.5 truncate text-caption text-muted-foreground">{resumo}</p>

      {/* Pagamento online: discreto. Ícone e texto curto, nunca só a cor (§3). */}
      {order.payment_method === "online" && (
        <p
          className={cn(
            "mt-2 flex items-center gap-1.5 text-caption",
            TONE_STRONG[paymentStatusTone(order.payment_status)]
          )}
        >
          <CreditCard className="h-4 w-4 shrink-0" aria-hidden="true" />
          {t(`orderManagement.paymentShort_${order.payment_status}`, order.payment_status ?? "")}
        </p>
      )}
    </button>
  );
};

/** Corpo do detalhe do pedido, partilhado pelo diálogo e pelo painel lateral. */
const OrderDetail = ({
  order,
  onPreviewProof,
  onValidatePayment,
  validating,
}: {
  order: Order;
  onPreviewProof: (url: string) => void;
  onValidatePayment: (status: "validado" | "rejeitado") => void;
  validating: boolean;
}) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-caption">
        {t(CONSUMPTION_LABEL_KEYS[order.consumption_option] ?? "", order.consumption_option)}
      </span>

      <div>
        <p className="text-caption text-muted-foreground">{t("orderManagement.customer")}</p>
        <p className="text-body font-medium">{order.customer_name}</p>
      </div>

      {order.consumption_option === "entrega" && (
        <div className="space-y-2 rounded-lg bg-progress-soft p-3">
          <p className="flex items-center gap-1.5 text-caption font-semibold text-progress-foreground">
            <Truck className="h-4 w-4" aria-hidden="true" /> {t("orderManagement.deliveryInfo")}
          </p>
          {order.customer_phone && (
            <div className="flex min-w-0 items-center justify-between gap-2">
              <a href={`tel:${order.customer_phone.replace(/\s/g, "")}`} className="flex min-w-0 items-center gap-2">
                <Phone className="h-4 w-4 shrink-0 text-progress-foreground" aria-hidden="true" />
                <span className="truncate text-body font-bold">{order.customer_phone}</span>
              </a>
              <CopyButton text={order.customer_phone} label={t("common.copy")} />
            </div>
          )}
          {order.bairro && (
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <MapPin className="h-4 w-4 shrink-0 text-progress-foreground" aria-hidden="true" />
                <span className="truncate text-body font-semibold">{order.bairro}</span>
              </div>
              <CopyButton text={order.bairro} label={t("common.copy")} />
            </div>
          )}
          {order.address && (
            <div className="flex min-w-0 items-start justify-between gap-2">
              <div className="flex min-w-0 items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-progress-foreground" aria-hidden="true" />
                <span className="break-words text-caption text-muted-foreground">{order.address}</span>
              </div>
              <CopyButton text={order.address} label={t("common.copy")} />
            </div>
          )}
          {order.voice_note_url && (
            <VoiceNote url={order.voice_note_url} customerName={order.customer_name} />
          )}
          <Button
            variant="outline"
            className="h-11 w-full gap-1.5 bg-card text-caption"
            onClick={() => {
              const info = [order.customer_name, order.customer_phone, order.bairro, order.address]
                .filter(Boolean)
                .join("\n");
              navigator.clipboard.writeText(info);
            }}
          >
            <Copy className="h-4 w-4" />
            {t("orderManagement.copyAllDelivery")}
          </Button>
        </div>
      )}

      <div>
        <p className="text-caption text-muted-foreground">{t("orderTracking.orderDetails")}</p>
        <div className="mt-1 space-y-1">
          {order.items.map((item, idx) => (
            <div key={idx} className="flex justify-between gap-3 text-body">
              <span className="min-w-0">{item.name} x{item.qty}</span>
              <span className="shrink-0 font-medium">{formatCFA(item.price * item.qty)}</span>
            </div>
          ))}
          <div className="flex justify-between border-t pt-1.5">
            <span className="text-body font-semibold">{t("orderTracking.total")}</span>
            <span className="text-price text-primary">{formatCFA(order.total)}</span>
          </div>
        </div>
      </div>

      {order.notes && (
        <div className="rounded-lg bg-muted p-3">
          <p className="text-caption text-muted-foreground">{t("orderTracking.notes")}</p>
          <p className="mt-0.5 text-body">{order.notes}</p>
        </div>
      )}

      {order.consumption_option !== "entrega" && order.address && (
        <div>
          <p className="text-caption text-muted-foreground">{t("orderTracking.deliveryAddress")}</p>
          <p className="text-body">{order.address}</p>
        </div>
      )}

      {order.preparation_time && (
        <div>
          <p className="text-caption text-muted-foreground">{t("orderManagement.prepTime")}</p>
          <p className="text-body">{order.preparation_time} min</p>
        </div>
      )}

      {order.payment_method === "online" && (
        <div className="space-y-2 rounded-lg bg-muted p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-caption font-semibold">{t("orderManagement.onlinePayment")}</p>
            <PaymentBadge status={order.payment_status} />
          </div>
          {order.payment_proof_url && (
            <button
              type="button"
              onClick={() => onPreviewProof(order.payment_proof_url as string)}
              className="block w-full"
            >
              <img
                src={order.payment_proof_url}
                alt={t("orderManagement.paymentProof")}
                className="max-h-48 w-full cursor-pointer rounded-md border object-contain transition-opacity hover:opacity-90"
              />
            </button>
          )}
          {order.payment_status === "pendente" && (
            // Empilhados em ecrã estreito: os rótulos são longos e os botões têm
            // whitespace-nowrap, por isso lado a lado não encolhiam e saíam fora.
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                className="h-12 flex-1 gap-1.5 text-caption"
                onClick={() => onValidatePayment("validado")}
                disabled={validating}
              >
                <Check className="h-4 w-4" />
                {t("orderManagement.confirmPayment")}
              </Button>
              <Button
                variant="destructive"
                className="h-12 flex-1 gap-1.5 text-caption"
                onClick={() => onValidatePayment("rejeitado")}
                disabled={validating}
              >
                <XCircle className="h-4 w-4" />
                {t("orderManagement.rejectPayment")}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default OrderManagement;
