import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Package,
  Clock,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Loader2,
  ShoppingBag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useCustomerOrders, type Order } from "@/hooks/useOrders";
import { LoadError } from "@/components/LoadError";
import { useTranslation } from "react-i18next";
import { formatCFA } from "@/lib/format";
import { OrderTotals } from "@/components/OrderTotals";
import { ehEnvio } from "@/hooks/useOrders";

const STATUS_LABELS: Record<string, { key: string; color: string }> = {
  novo: { key: "orderStatus.novo", color: "bg-blue-100 text-blue-800" },
  confirmado: { key: "orderStatus.confirmado", color: "bg-success-soft text-success-foreground" },
  em_preparacao: { key: "orderStatus.em_preparacao", color: "bg-yellow-100 text-yellow-800" },
  na_cozinha: { key: "orderStatus.na_cozinha", color: "bg-orange-100 text-orange-800" },
  pronto: { key: "orderStatus.pronto", color: "bg-success-soft text-success-foreground" },
  saiu_para_entrega: { key: "orderStatus.saiu_para_entrega", color: "bg-blue-100 text-blue-800" },
  aguardando_motorista: { key: "orderStatus.aguardando_motorista", color: "bg-purple-100 text-purple-800" },
  motorista_encontrado: { key: "orderStatus.motorista_encontrado", color: "bg-indigo-100 text-indigo-800" },
  pedido_recolhido: { key: "orderStatus.pedido_recolhido", color: "bg-blue-100 text-blue-800" },
  a_caminho: { key: "orderStatus.a_caminho", color: "bg-blue-100 text-blue-800" },
  entregue: { key: "orderStatus.entregue", color: "bg-success-soft text-success-foreground" },
  concluido: { key: "orderStatus.concluido", color: "bg-success-soft text-success-foreground" },
  cancelado: { key: "orderStatus.cancelado", color: "bg-problem-soft text-problem-foreground" },
};

const MyOrdersPage = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: orders = [], isLoading, isError, refetch } = useCustomerOrders(user?.id ?? null);

  if (!user) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-6">
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
          <ShoppingBag className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="text-muted-foreground">{t("myOrders.loginRequired")}</p>
          <Button onClick={() => navigate("/login")} className="mt-4">
            {t("auth.loginButton")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-20">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-bold">{t("myOrders.title")}</h1>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {/* Fase 9.2 -- a falha tem de vir ANTES do estado vazio. Com erro de rede a
          lista fica [] por omissao e caia em "nao tem pedidos": dizer ao cliente
          que nao encomendou quando so nao se conseguiu ler, e pode leva-lo a
          encomendar outra vez (§73). */}
      {!isLoading && isError && orders.length === 0 && (
        <LoadError onRetry={() => void refetch()} />
      )}

      {!isLoading && !isError && orders.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <ShoppingBag className="h-8 w-8 text-primary/50" />
          </div>
          <p className="text-sm font-medium text-muted-foreground">{t("myOrders.empty")}</p>
          <p className="text-xs text-muted-foreground mt-1">{t("myOrders.emptyHint")}</p>
          <Button onClick={() => navigate("/explorar")} className="mt-4" variant="outline">
            {t("myOrders.browseRestaurants")}
          </Button>
        </div>
      )}

      {!isLoading && orders.length > 0 && (
        <div className="flex flex-col gap-3">
          {orders.map((order) => {
            const statusInfo = STATUS_LABELS[order.status] ?? { key: order.status, color: "bg-gray-100 text-gray-800" };
            return (
              <Link
                key={order.id}
                to={`/pedido/${order.id}`}
                className="block"
              >
                <Card className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-bold">#{order.order_number}</span>
                          <Badge className={`text-[10px] px-1.5 py-0 ${statusInfo.color}`}>
                            {t(statusInfo.key)}
                          </Badge>
                        </div>
                        {/* Um envio não tem restaurante nem artigos: sem isto
                            aparecia sem nome e com "0 itens". */}
                        <p className="text-sm font-medium truncate">
                          {ehEnvio(order) ? `📦 ${t("myOrders.sendLabel")}` : order.business_name}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {!ehEnvio(order) && <>{order.items.length} {t("myOrders.items")} ·{" "}</>}
                          <OrderTotals
                            variant="inline"
                            total={order.total}
                            deliveryFee={order.delivery_fee}
                            consumptionOption={order.consumption_option}
                          />
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {new Date(order.created_at).toLocaleDateString()} {new Date(order.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0 mt-1" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MyOrdersPage;
