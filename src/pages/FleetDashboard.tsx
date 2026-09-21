import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowLeft, Bike, Plus, Power, Trash2, MapPin, KeyRound } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FleetCashClosing } from "@/components/FleetCashClosing";
import { toast } from "sonner";
import { formatCFA } from "@/lib/format";
import { useFleetFinancials, type MovimentoLedger } from "@/hooks/useFleetFinancials";
import { LOCATION_OPTIONS } from "@/lib/locations";
import { useAuth } from "@/hooks/useAuth";
import { FleetDriverDetail } from "@/components/FleetDriverDetail";
import {
  useFleetMetrics,
  useCreateFleet,
  useFleetDrivers,
  useZonePrices,
  useAddDriver,
  useSetDriverActive,
  useRemoveDriver,
  useResetDriverPin,
  useUpsertZonePrice,
} from "@/hooks/useFleet";

/**
 * Painel da frota — §32.
 *
 * Fica de fora de propósito: comissão, dívida e histórico de pagamentos. Isso
 * vive no ledger da Fase 6, e §30 diz que nenhum saldo se apresenta sem as
 * transações que o explicam. Melhor não mostrar nada do que mostrar um número
 * que o sistema ainda não sabe justificar (§84).
 *
 * Quilometragem também fica de fora (§40): o GPS ainda não é fiável o
 * suficiente para apresentar valores como se fossem precisos.
 */

/**
 * Os tipos do ledger em português corrente. O motorista e o dono da frota não
 * têm de saber o que é um `entry_type`.
 */
const CHAVE_MOVIMENTO: Record<string, string> = {
  comissao_frota: "fleetDashboard.entry.comissao_frota",
  divida_comida: "fleetDashboard.entry.divida_comida",
  pagamento_comissao: "fleetDashboard.entry.pagamento_comissao",
  reversao: "fleetDashboard.entry.reversao",
};

const Metric = ({ label, value }: { label: string; value: string | number }) => (
  <Card>
    <CardContent className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold mt-1">{value}</p>
    </CardContent>
  </Card>
);

const FleetDashboard = () => {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const { data: financas } = useFleetFinancials();
  const { data: metrics, isLoading } = useFleetMetrics();
  const { data: drivers = [] } = useFleetDrivers();
  const { data: prices = [] } = useZonePrices(metrics?.fleet_id ?? null);

  const addDriver = useAddDriver();
  const setActive = useSetDriverActive();
  const removeDriver = useRemoveDriver();
  const upsertPrice = useUpsertZonePrice();
  const createFleet = useCreateFleet();
  const resetPin = useResetDriverPin();

  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [bairro, setBairro] = useState(LOCATION_OPTIONS[0]);
  const [preco, setPreco] = useState("");
  /** PIN devolvido pela criação, para a frota passar ao motorista. */
  const [pinNovo, setPinNovo] = useState<{ nome: string; telefone: string; pin: string } | null>(null);
  /** Motorista aberto no painel lateral de detalhe. */
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [fleetName, setFleetName] = useState("");
  const [fleetPhone, setFleetPhone] = useState("");

  const fail = (e: unknown) =>
    toast.error(e instanceof Error ? e.message : t("fleetDashboard.genericError"));

  const onAddDriver = () => {
    if (!phone.trim() || !name.trim()) return;
    const nome = name.trim();
    addDriver.mutate(
      { phone: phone.trim(), name: nome },
      {
        onSuccess: (r) => {
          if (r.pin) {
            setPinNovo({ nome, telefone: r.telefone, pin: r.pin });
            toast.success(t("fleetDashboard.driverCreated"));
          } else {
            // Já tinha conta: não há PIN novo, entra com o dele.
            setPinNovo(null);
            toast.success(t("fleetDashboard.driverLinked"));
          }
          setPhone("");
          setName("");
        },
        onError: fail,
      },
    );
  };

  const onSavePrice = () => {
    const valor = Number(preco);
    if (!bairro || !Number.isFinite(valor) || valor < 0) return;
    upsertPrice.mutate(
      { bairro, preco: valor },
      {
        onSuccess: () => {
          toast.success(`${bairro}: ${formatCFA(valor)}`);
          setPreco("");
        },
        onError: fail,
      },
    );
  };

  const onCreateFleet = () => {
    if (!fleetName.trim() || !fleetPhone.trim()) return;
    createFleet.mutate(
      { name: fleetName.trim(), phone: fleetPhone.trim() },
      { onSuccess: () => toast.success(t("fleetDashboard.fleetCreated")), onError: fail },
    );
  };

  if (authLoading || isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  }

  if (!user) {
    return (
      <div className="p-6 space-y-3 max-w-md mx-auto text-center">
        <p className="font-semibold">{t("fleetDashboard.loginNeeded")}</p>
        <Link to="/login" className="text-primary hover:underline text-sm">
          {t("fleetDashboard.goToLogin")}
        </Link>
      </div>
    );
  }

  /* Sem frota ainda: este e' o ecra' que a cria. E' tambem o que torna
     desnecessaria uma guarda de papel na rota -- quem nao tem frota ve' o
     formulario, quem tem ve' o painel, e o servidor e' que decide qual dos dois
     pela resposta de get_fleet_metrics(). */
  if (!metrics) {
    return (
      <div className="max-w-md mx-auto p-4 space-y-4">
        <div className="flex items-center gap-3">
          <Link to="/perfil" className="p-1 -ml-1 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-xl font-bold">{t("fleetDashboard.registerTitle")}</h1>
        </div>
        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("fleetDashboard.registerIntro")}
            </p>
            <div className="space-y-2">
              <Label htmlFor="fnome">{t("fleetDashboard.fleetName")}</Label>
              <Input
                id="fnome"
                value={fleetName}
                onChange={(e) => setFleetName(e.target.value)}
                placeholder={t("fleetDashboard.fleetNamePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ftel">{t("fleetDashboard.contactPhone")}</Label>
              <Input
                id="ftel"
                inputMode="tel"
                value={fleetPhone}
                onChange={(e) => setFleetPhone(e.target.value)}
                placeholder="9XXXXXXXX"
              />
            </div>
            <Button
              onClick={onCreateFleet}
              disabled={createFleet.isPending}
              className="w-full h-12"
            >
              {t("fleetDashboard.createFleet")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4 pb-24">
      <div className="flex items-center gap-3">
        <Link to="/perfil" className="p-1 -ml-1 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-xl font-bold truncate">{metrics.fleet_name}</h1>
          <p className="text-xs text-muted-foreground">{t("fleetDashboard.title")}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Metric label={t("fleetDashboard.deliveries")} value={metrics.entregas} />
        <Metric label={t("fleetDashboard.completed")} value={metrics.concluidas} />
        <Metric label={t("fleetDashboard.activeDrivers")} value={`${metrics.motoristas_activos}/${metrics.motoristas}`} />
        <Metric label={t("fleetDashboard.deliveriesValue")} value={formatCFA(metrics.valor_entregas)} />
      </div>

      <Tabs defaultValue="motoristas">
        <TabsList className="w-full">
          <TabsTrigger value="motoristas" className="flex-1">{t("fleetDashboard.tabDrivers")}</TabsTrigger>
          <TabsTrigger value="precos" className="flex-1">{t("fleetDashboard.tabPrices")}</TabsTrigger>
          <TabsTrigger value="caixa" className="flex-1">{t("fleetDashboard.tabCash")}</TabsTrigger>
          <TabsTrigger value="financeiro" className="flex-1">{t("fleetDashboard.tabFinance")}</TabsTrigger>
        </TabsList>

        {/* ── Motoristas (§12) ─────────────────────────────────────────── */}
        <TabsContent value="motoristas" className="space-y-3 mt-3">
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="text-sm font-semibold">{t("fleetDashboard.addDriver")}</p>
              <p className="text-xs text-muted-foreground">
                {t("fleetDashboard.addDriverHint")}
              </p>
              <div className="space-y-2">
                <Label htmlFor="nome">{t("fleetDashboard.name")}</Label>
                <Input
                  id="nome"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("fleetDashboard.driverNamePlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tel">{t("fleetDashboard.phone")}</Label>
                <Input
                  id="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="9XXXXXXXX"
                />
              </div>
              <Button
                onClick={onAddDriver}
                disabled={addDriver.isPending || !name.trim() || !phone.trim()}
                className="w-full h-12"
              >
                <Plus className="h-4 w-4 mr-2" />
                {addDriver.isPending ? t("fleetDashboard.creating") : t("fleetDashboard.createDriver")}
              </Button>
            </CardContent>
          </Card>

          {pinNovo && (
            <Card className="border-primary/40 bg-primary/5">
              <CardContent className="p-4 space-y-2">
                <p className="text-sm font-semibold">{t("fleetDashboard.pinFor", { name: pinNovo.nome })}</p>
                <p className="text-4xl font-bold tracking-widest text-primary tabular-nums">
                  {pinNovo.pin}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("fleetDashboard.pinHint", { phone: pinNovo.telefone })}
                </p>
                <Button variant="outline" size="sm" onClick={() => setPinNovo(null)}>
                  {t("fleetDashboard.pinNoted")}
                </Button>
              </CardContent>
            </Card>
          )}

          {drivers.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              {t("fleetDashboard.noDrivers")}
            </p>
          )}

          {drivers.map((d) => (
            <Card key={d.id}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Bike className="h-5 w-5 text-primary" />
                </div>
                <button
                  type="button"
                  onClick={() => setDetalheId(d.id)}
                  className="min-w-0 flex-1 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <p className="font-semibold truncate underline-offset-2 hover:underline">{d.name}</p>
                  <p className="text-xs text-muted-foreground">{d.phone}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("fleetDashboard.driverLine", {
                      done: d.concluidas,
                      total: d.entregas,
                      amount: formatCFA(d.valor_entregas),
                    })}
                  </p>
                  <p className="text-[11px] text-primary mt-1">{t("fleetDashboard.seeDetails")}</p>
                </button>
                <div className="flex flex-col gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant={d.is_available ? "default" : "outline"}
                    onClick={() =>
                      setActive.mutate(
                        { driverId: d.id, active: !d.is_available },
                        { onError: fail },
                      )
                    }
                  >
                    <Power className="h-4 w-4 mr-1" />
                    {d.is_available ? t("fleetDashboard.active") : t("fleetDashboard.inactive")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={resetPin.isPending}
                    onClick={() =>
                      resetPin.mutate(d.id, {
                        onSuccess: (r) => {
                          setPinNovo({ nome: r.nome ?? d.name, telefone: r.telefone, pin: r.pin });
                          toast.success(t("fleetDashboard.newPinDone"));
                        },
                        onError: fail,
                      })
                    }
                  >
                    <KeyRound className="h-4 w-4 mr-1" /> {t("fleetDashboard.newPin")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeDriver.mutate(d.id, { onError: fail })}
                  >
                    <Trash2 className="h-4 w-4 mr-1" /> {t("fleetDashboard.remove")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* ── Preços por bairro (§13, §14, §15) ────────────────────────── */}
        <TabsContent value="precos" className="space-y-3 mt-3">
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="text-sm font-semibold">{t("fleetDashboard.setZonePrice")}</p>
              <p className="text-xs text-muted-foreground">
                {t("fleetDashboard.zonePriceHint")}
              </p>
              <div className="space-y-2">
                <Label htmlFor="bairro">{t("fleetDashboard.bairro")}</Label>
                <select
                  id="bairro"
                  className="w-full h-12 rounded-md border bg-background px-3 text-sm"
                  value={bairro}
                  onChange={(e) => setBairro(e.target.value)}
                >
                  {LOCATION_OPTIONS.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="preco">{t("fleetDashboard.priceFcfa")}</Label>
                <Input
                  id="preco"
                  inputMode="numeric"
                  value={preco}
                  onChange={(e) => setPreco(e.target.value)}
                  placeholder="1000"
                />
              </div>
              <Button onClick={onSavePrice} disabled={upsertPrice.isPending} className="w-full h-12">
                {t("fleetDashboard.savePrice")}
              </Button>
            </CardContent>
          </Card>

          {prices.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              {t("fleetDashboard.noPrices")}
            </p>
          )}

          {prices.map((p) => (
            <Card key={p.id}>
              <CardContent className="p-4 flex items-center gap-3">
                <MapPin className="h-5 w-5 text-primary shrink-0" />
                <p className="flex-1 font-medium truncate">{p.bairro}</p>
                <p className="font-bold">{formatCFA(p.preco)}</p>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* ── Financeiro (§26, §28, §32, §84) ──────────────────────────── */}
        {/* Fase 2.3 — separado do "Financeiro" de propósito: ali está a dívida à
            PLATAFORMA (comissão, §26); aqui está dinheiro de terceiros que
            passou pelas mãos dos motoristas (§28). Somá-los num ecrã só levava
            a frota a pensar que devia o total a uma pessoa. */}
        <TabsContent value="caixa" className="space-y-3 mt-3">
          <FleetCashClosing />
        </TabsContent>

        <TabsContent value="financeiro" className="space-y-3 mt-3">
          {!financas ? (
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Metric label={t("fleetDashboard.billedDeliveries")} value={financas.entregas_faturadas} />
                <Metric label={t("fleetDashboard.deliveriesValue")} value={formatCFA(financas.valor_entregas)} />
                <Metric label={t("fleetDashboard.commissionGenerated")} value={formatCFA(financas.comissao_gerada)} />
                <Metric label={t("fleetDashboard.commissionPaid")} value={formatCFA(financas.comissao_paga)} />
              </div>

              {/* As duas dívidas são de naturezas diferentes e não se somam:
                  uma é comissão da plataforma (§26), a outra é dinheiro do
                  restaurante que passou pelas mãos do motorista (§28). */}
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground uppercase">{t("fleetDashboard.platformDebt")}</p>
                      <p className="text-xs text-muted-foreground">{t("fleetDashboard.commissionRate", { rate: financas.taxa_actual })}</p>
                    </div>
                    <p className="text-xl font-bold whitespace-nowrap">{formatCFA(financas.divida_plataforma)}</p>
                  </div>
                  <Button
                    className="w-full h-12"
                    disabled={financas.divida_plataforma <= 0}
                    onClick={() => toast.info(t("fleetDashboard.payCommissionInfo"))}
                  >
                    {t("fleetDashboard.payCommission")}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground uppercase">{t("fleetDashboard.owedToRestaurants")}</p>
                      {/* §28: o cliente paga ao motorista, que fica com a taxa
                          e deve a comida ao restaurante. Este número é dinheiro
                          de outra pessoa, não receita da frota. */}
                      <p className="text-xs text-muted-foreground">{t("fleetDashboard.owedToRestaurantsHint")}</p>
                    </div>
                    <p className="text-xl font-bold whitespace-nowrap">{formatCFA(financas.divida_restaurantes)}</p>
                  </div>
                </CardContent>
              </Card>

              {/* O espelho do §28: nos pedidos pagos online o cliente paga tudo
                  ao restaurante, pelo merchant_code dele, e a taxa de entrega
                  fica lá — é da frota (decisão de 2026-09-15). Cartão separado
                  do de cima de propósito: um é dinheiro a sair, o outro a
                  entrar, e juntos num só número não se percebia nenhum. */}
              {financas.a_receber_restaurantes > 0 && (
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground uppercase">{t("fleetDashboard.dueFromRestaurants")}</p>
                        <p className="text-xs text-muted-foreground">{t("fleetDashboard.dueFromRestaurantsHint")}</p>
                      </div>
                      <p className="text-xl font-bold whitespace-nowrap text-primary">
                        {formatCFA(financas.a_receber_restaurantes)}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* §84: nunca mostrar "deves X" sem conseguir explicar porquê. */}
              <Card>
                <CardContent className="p-4 space-y-2">
                  <p className="text-sm font-semibold">{t("fleetDashboard.entries")}</p>
                  {financas.movimentos.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {t("fleetDashboard.noEntries")}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {financas.movimentos.map((m: MovimentoLedger) => (
                        <div
                          key={m.id}
                          className={`flex items-baseline justify-between gap-2 border-b pb-2 last:border-0 ${m.revertida ? "opacity-50" : ""}`}
                        >
                          <div className="min-w-0">
                            <p className="text-sm truncate">
                              {CHAVE_MOVIMENTO[m.tipo] ? t(CHAVE_MOVIMENTO[m.tipo]) : m.tipo}
                              {m.pedido != null && <span className="text-muted-foreground"> · #{m.pedido}</span>}
                              {m.revertida && <span className="text-muted-foreground"> · {t("fleetDashboard.reversed")}</span>}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {new Date(m.quando).toLocaleString()}
                              {m.base != null && m.taxa != null && ` · ${formatCFA(m.base)} × ${m.taxa}%`}
                            </p>
                          </div>
                          <span className="text-sm font-semibold whitespace-nowrap">
                            {formatCFA(m.valor)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>

      <FleetDriverDetail driverId={detalheId} onClose={() => setDetalheId(null)} />
    </div>
  );
};

export default FleetDashboard;
