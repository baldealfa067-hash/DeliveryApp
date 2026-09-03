import { useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  ArrowLeft,
  Package,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import {
  useCustomerOrders,
  useBusinessOrders,
  useOrderHistory,
  useUpdateOrderStatus,
  type Order,
} from "@/hooks/useOrders";
import { useTranslation } from "react-i18next";
import { formatCFA } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";

const ORDER_STATUS_FLOW = [
  "novo",
  "confirmado",
  "em_preparacao",
  "na_cozinha",
  "pronto",
  "saiu_para_entrega",
  "aguardando_motorista",
  "motorista_encontrado",
  "pedido_recolhido",
  "a_caminho",
  "entregue",
  "concluido",
];

const STATUS_ICONS: Record<string, string> = {
  novo: "📋",
  confirmado: "✅",
  em_preparacao: "🍳",
  na_cozinha: "🔥",
  pronto: "🍔",
  saiu_para_entrega: "🛵",
  aguardando_motorista: "🛵",
  motorista_encontrado: "🛵",
  pedido_recolhido: "📦",
  a_caminho: "📍",
  entregue: "✅",
  concluido: "🎉",
  cancelado: "❌",
};

const OrderTrackingPage = () => {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: customerOrders = [] } = useCustomerOrders(user?.id ?? null);
  const { data: history = [] } = useOrderHistory(id ?? null);

  const order = customerOrders.find((o) => o.id === id);

  if (!user) {
    navigate("/login", { replace: true });
    return null;
  }

  if (!order && customerOrders.length > 0) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-6">
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
          <XCircle className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="text-muted-foreground">{t("orderTracking.notFound")}</p>
          <Button onClick={() => navigate("/meus-pedidos")} className="mt-4" variant="outline">
            {t("myOrders.title")}
          </Button>
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const currentStatusIndex = ORDER_STATUS_FLOW.indexOf(order.status);

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-20">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-lg font-bold">{t("orderTracking.title")} #{order.order_number}</h1>
          <p className="text-xs text-muted-foreground">{order.business_name}</p>
        </div>
      </div>

      {/* Status Banner */}
      <Card className="mb-4 border-primary/20">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{STATUS_ICONS[order.status] ?? "📋"}</span>
            <div>
              <p className="text-sm font-bold">{t(`orderStatus.${order.status.replace(/\./g, "_")}`, order.status)}</p>
              {order.preparation_time && order.status === "em_preparacao" && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  ⏱️ {t("orderTracking.estimatedTime", { time: order.preparation_time })}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Order Items */}
      <Card className="mb-4">
        <CardContent className="p-4">
          <h2 className="text-sm font-semibold mb-2">{t("orderTracking.orderDetails")}</h2>
          <div className="space-y-1.5">
            {order.items.map((item, idx) => (
              <div key={idx} className="flex justify-between text-sm">
                <span>{item.name} x{item.qty}</span>
                <span className="font-medium">{formatCFA(item.price * item.qty)}</span>
              </div>
            ))}
            <div className="flex justify-between text-sm font-bold border-t pt-1.5 mt-1.5">
              <span>{t("orderTracking.total")}</span>
              <span>{formatCFA(order.total)}</span>
            </div>
          </div>
          {order.notes && (
            <div className="mt-3 p-2 bg-muted/50 rounded-lg">
              <p className="text-xs font-medium text-muted-foreground">{t("orderTracking.notes")}</p>
              <p className="text-sm mt-0.5">{order.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Progress Timeline */}
      <Card className="mb-4">
        <CardContent className="p-4">
          <h2 className="text-sm font-semibold mb-3">{t("orderTracking.progress")}</h2>
          <div className="space-y-0">
            {ORDER_STATUS_FLOW.map((status, idx) => {
              const isPast = idx < currentStatusIndex;
              const isCurrent = idx === currentStatusIndex;
              const isFuture = idx > currentStatusIndex;
              const historyEntry = history.find((h) => h.status === status);

              return (
                <div key={status} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                        isPast
                          ? "bg-primary text-primary-foreground"
                          : isCurrent
                          ? "bg-primary text-primary-foreground ring-2 ring-primary/30"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {isPast ? "✓" : isCurrent ? STATUS_ICONS[status] ?? "●" : "○"}
                    </div>
                    {idx < ORDER_STATUS_FLOW.length - 1 && (
                      <div className={`w-0.5 h-6 ${isPast ? "bg-primary" : "bg-muted"}`} />
                    )}
                  </div>
                  <div className="pb-4">
                    <p className={`text-sm ${isCurrent ? "font-semibold" : isPast ? "text-muted-foreground" : "text-muted-foreground/50"}`}>
                      {t(`orderStatus.${status}`, status)}
                    </p>
                    {historyEntry && (
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(historyEntry.created_at).toLocaleString()}
                        {historyEntry.note && ` · ${historyEntry.note}`}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Delivery Address */}
      {order.address && (
        <Card className="mb-4">
          <CardContent className="p-4">
            <h2 className="text-sm font-semibold mb-1">{t("orderTracking.deliveryAddress")}</h2>
            <p className="text-sm text-muted-foreground">{order.address}</p>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="space-y-2">
        <Link to={`/loja/${order.business_id}`}>
          <Button variant="outline" className="w-full gap-2">
            <MessageSquare className="h-4 w-4" />
            {t("orderTracking.messageRestaurant")}
          </Button>
        </Link>
      </div>
    </div>
  );
};

export default OrderTrackingPage;
