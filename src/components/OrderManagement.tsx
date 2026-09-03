import { useState, useEffect } from "react";
import {
  Package,
  Clock,
  CheckCircle2,
  ChefHat,
  UtensilsCrossed,
  Loader2,
  Eye,
  MessageSquare,
  Timer,
  XCircle,
  Copy,
  Check,
  Truck,
  MapPin,
  Phone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { useBusinessOrders, useUpdateOrderStatus, type Order } from "@/hooks/useOrders";
import { useTranslation } from "react-i18next";
import { formatCFA } from "@/lib/format";

const STATUS_TABS = [
  { value: "novo", label: "orderStatus.novo", icon: Package, color: "text-blue-600" },
  { value: "confirmado", label: "orderStatus.confirmado", icon: CheckCircle2, color: "text-green-600" },
  { value: "em_preparacao", label: "orderStatus.em_preparacao", icon: ChefHat, color: "text-yellow-600" },
  { value: "pronto", label: "orderStatus.pronto", icon: UtensilsCrossed, color: "text-green-600" },
  { value: "saiu_para_entrega", label: "orderStatus.saiu_para_entrega", icon: Truck, color: "text-blue-600" },
  { value: "entregue", label: "orderStatus.entregue", icon: CheckCircle2, color: "text-green-600" },
  { value: "cancelado", label: "orderStatus.cancelado", icon: XCircle, color: "text-red-600" },
];

const NEXT_STATUS: Record<string, string[]> = {
  novo: ["confirmado", "cancelado"],
  confirmado: ["em_preparacao", "cancelado"],
  em_preparacao: ["pronto"],
  pronto: ["saiu_para_entrega", "entregue"],
  saiu_para_entrega: ["entregue"],
  aguardando_motorista: [],
  motorista_encontrado: ["pedido_recolhido"],
  pedido_recolhido: ["a_caminho"],
  a_caminho: ["entregue"],
  entregue: ["concluido"],
};

const CONSUMPTION_LABELS: Record<string, string> = {
  comer_no_local: "🍽️ Local",
  para_levar: "🥡 Levar",
  entrega: "🛵 Entrega",
};

interface CopyButtonProps {
  text: string;
  label?: string;
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
      className="h-6 px-1.5 gap-1 text-xs"
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-600" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
      {label ?? text}
    </Button>
  );
};

interface OrderManagementProps {
  businessId: string;
}

const OrderManagement = ({ businessId }: OrderManagementProps) => {
  const { t } = useTranslation();
  const { data: allOrders = [], isLoading, refetch } = useBusinessOrders(businessId);
  const updateStatus = useUpdateOrderStatus();
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [prepTimeDialogOpen, setPrepTimeDialogOpen] = useState(false);
  const [prepTimeInput, setPrepTimeInput] = useState("");
  const [pendingStatus, setPendingStatus] = useState("");

  useEffect(() => {
    const interval = setInterval(() => refetch(), 10000);
    return () => clearInterval(interval);
  }, [refetch]);

  const getOrdersByStatus = (status: string) =>
    allOrders.filter((o) => o.status === status);

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

  return (
    <div>
      <Tabs defaultValue="novo">
        <TabsList className="w-full grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 h-auto p-1 gap-1 bg-muted/50">
          {STATUS_TABS.map((tab) => {
            const count = getOrdersByStatus(tab.value).length;
            const Icon = tab.icon;
            return (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="flex flex-col items-center gap-0.5 text-[11px] min-h-14 px-1 py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                <Icon className={`h-4 w-4 ${tab.color}`} />
                <span className="leading-tight text-center">{t(tab.label)}</span>
                {count > 0 && (
                  <Badge className="h-4 min-w-[16px] text-[9px] px-1 mt-0.5">({count})</Badge>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {STATUS_TABS.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : getOrdersByStatus(tab.value).length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                {t("orderManagement.noOrders")}
              </div>
            ) : (
              <div className="flex flex-col gap-3 mt-3">
                {getOrdersByStatus(tab.value).map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    onView={() => {
                      setSelectedOrder(order);
                      setDetailOpen(true);
                    }}
                    onStatusChange={(newStatus) => handleStatusChange(order.id, newStatus)}
                    nextStatuses={NEXT_STATUS[order.status] ?? []}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      {/* Order Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          {selectedOrder && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  #{selectedOrder.order_number}
                  <Badge variant="secondary">{t(`orderStatus.${selectedOrder.status}`, selectedOrder.status)}</Badge>
                </DialogTitle>
                <DialogDescription>
                  {new Date(selectedOrder.created_at).toLocaleString()}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                {/* Consumption type */}
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {CONSUMPTION_LABELS[selectedOrder.consumption_option] ?? selectedOrder.consumption_option}
                  </Badge>
                </div>

                {/* Customer info */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{t("orderManagement.customer")}</p>
                  <p className="text-sm font-medium">{selectedOrder.customer_name}</p>
                </div>

                {/* Delivery info — prominent for entrega */}
                {selectedOrder.consumption_option === "entrega" && (
                  <div className="rounded-lg border-2 border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950 p-3 space-y-2">
                    <p className="text-xs font-bold text-blue-700 dark:text-blue-300 uppercase tracking-wide flex items-center gap-1">
                      <Truck className="h-3.5 w-3.5" /> {t("orderManagement.deliveryInfo")}
                    </p>
                    {selectedOrder.customer_phone && (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Phone className="h-4 w-4 text-blue-600" />
                          <span className="text-sm font-bold">{selectedOrder.customer_phone}</span>
                        </div>
                        <CopyButton text={selectedOrder.customer_phone} />
                      </div>
                    )}
                    {selectedOrder.bairro && (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-blue-600" />
                          <span className="text-sm font-semibold">{selectedOrder.bairro}</span>
                        </div>
                        <CopyButton text={selectedOrder.bairro} />
                      </div>
                    )}
                    {selectedOrder.address && (
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 min-w-0">
                          <MapPin className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                          <span className="text-xs text-muted-foreground break-words">{selectedOrder.address}</span>
                        </div>
                        <CopyButton text={selectedOrder.address} label={t("common.copy")} />
                      </div>
                    )}
                    {/* Copy all delivery info button */}
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full gap-1.5 text-xs"
                      onClick={() => {
                        const info = [
                          selectedOrder.customer_name,
                          selectedOrder.customer_phone,
                          selectedOrder.bairro,
                          selectedOrder.address,
                        ].filter(Boolean).join("\n");
                        navigator.clipboard.writeText(info);
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {t("orderManagement.copyAllDelivery")}
                    </Button>
                  </div>
                )}

                {/* Order items */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{t("orderTracking.orderDetails")}</p>
                  <div className="space-y-1 mt-1">
                    {selectedOrder.items.map((item, idx) => (
                      <div key={idx} className="flex justify-between text-sm">
                        <span>{item.name} x{item.qty}</span>
                        <span className="font-medium">{formatCFA(item.price * item.qty)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between text-sm font-bold border-t pt-1 mt-1">
                      <span>{t("orderTracking.total")}</span>
                      <span>{formatCFA(selectedOrder.total)}</span>
                    </div>
                  </div>
                </div>

                {selectedOrder.notes && (
                  <div className="p-2 bg-muted/50 rounded-lg">
                    <p className="text-xs font-medium text-muted-foreground">{t("orderTracking.notes")}</p>
                    <p className="text-sm mt-0.5">{selectedOrder.notes}</p>
                  </div>
                )}

                {/* Non-delivery address */}
                {selectedOrder.consumption_option !== "entrega" && selectedOrder.address && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">{t("orderTracking.deliveryAddress")}</p>
                    <p className="text-sm">{selectedOrder.address}</p>
                  </div>
                )}

                {selectedOrder.preparation_time && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">{t("orderManagement.prepTime")}</p>
                    <p className="text-sm">{selectedOrder.preparation_time} min</p>
                  </div>
                )}
              </div>

              <DialogFooter className="flex-row gap-2 flex-wrap">
                {NEXT_STATUS[selectedOrder.status]?.map((newStatus) => (
                  <Button
                    key={newStatus}
                    size="sm"
                    variant={newStatus === "cancelado" ? "destructive" : "default"}
                    onClick={() => {
                      setDetailOpen(false);
                      handleStatusChange(selectedOrder.id, newStatus);
                    }}
                    disabled={updateStatus.isPending}
                    className="gap-1"
                  >
                    {newStatus === "saiu_para_entrega" && <Truck className="h-3.5 w-3.5" />}
                    {t(`orderStatus.${newStatus}`, newStatus)}
                  </Button>
                ))}
              </DialogFooter>
            </>
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

const OrderCard = ({
  order,
  onView,
  onStatusChange,
  nextStatuses,
}: {
  order: Order;
  onView: () => void;
  onStatusChange: (status: string) => void;
  nextStatuses: string[];
}) => {
  const { t } = useTranslation();
  const primaryAction = nextStatuses.find((s) => s !== "cancelado");

  return (
    <Card>
      <CardContent className="p-3">
        {/* Top line: number + time + total */}
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold">#{order.order_number}</span>
            <span className="text-xs text-muted-foreground">
              {new Date(order.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
          <span className="text-base font-bold text-primary">{formatCFA(order.total)}</span>
        </div>

        {/* Items */}
        <p className="text-sm text-muted-foreground truncate mb-1.5">
          {order.items.map((i) => `${i.name} x${i.qty}`).join(", ")}
        </p>

        {/* Delivery quick info */}
        {order.consumption_option === "entrega" && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2">
            {order.customer_phone && (
              <span className="flex items-center gap-1">
                <Phone className="h-3 w-3" /> {order.customer_phone}
              </span>
            )}
            {order.bairro && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" /> {order.bairro}
              </span>
            )}
          </div>
        )}

        {/* Action buttons — big, easy to tap */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="lg"
            onClick={onView}
            className="flex-1 min-h-12 text-sm"
          >
            {t("common.view")}
          </Button>
          {primaryAction && (
            <Button
              size="lg"
              onClick={() => onStatusChange(primaryAction)}
              className="flex-1 min-h-12 text-sm gap-1.5"
            >
              {primaryAction === "saiu_para_entrega" && <Truck className="h-4 w-4" />}
              {t(`orderStatus.${primaryAction}`, primaryAction)}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default OrderManagement;
