import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Bike, Plus, Power, Trash2, MapPin } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { formatCFA } from "@/lib/format";
import { LOCATION_OPTIONS } from "@/lib/locations";
import { useAuth } from "@/hooks/useAuth";
import {
  useFleetMetrics,
  useCreateFleet,
  useFleetDrivers,
  useZonePrices,
  useAddDriver,
  useSetDriverActive,
  useRemoveDriver,
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

const Metric = ({ label, value }: { label: string; value: string | number }) => (
  <Card>
    <CardContent className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold mt-1">{value}</p>
    </CardContent>
  </Card>
);

const FleetDashboard = () => {
  const { user, loading: authLoading } = useAuth();
  const { data: metrics, isLoading } = useFleetMetrics();
  const { data: drivers = [] } = useFleetDrivers();
  const { data: prices = [] } = useZonePrices(metrics?.fleet_id ?? null);

  const addDriver = useAddDriver();
  const setActive = useSetDriverActive();
  const removeDriver = useRemoveDriver();
  const upsertPrice = useUpsertZonePrice();
  const createFleet = useCreateFleet();

  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [bairro, setBairro] = useState(LOCATION_OPTIONS[0]);
  const [preco, setPreco] = useState("");
  /** PIN devolvido pela criação, para a frota passar ao motorista. */
  const [pinNovo, setPinNovo] = useState<{ nome: string; telefone: string; pin: string } | null>(null);
  const [fleetName, setFleetName] = useState("");
  const [fleetPhone, setFleetPhone] = useState("");

  const fail = (e: unknown) =>
    toast.error(e instanceof Error ? e.message : "Não foi possível concluir a operação");

  const onAddDriver = () => {
    if (!phone.trim() || !name.trim()) return;
    const nome = name.trim();
    addDriver.mutate(
      { phone: phone.trim(), name: nome },
      {
        onSuccess: (r) => {
          if (r.pin) {
            setPinNovo({ nome, telefone: r.telefone, pin: r.pin });
            toast.success("Motorista criado");
          } else {
            // Já tinha conta: não há PIN novo, entra com o dele.
            setPinNovo(null);
            toast.success("Este número já tinha conta — motorista associado à frota");
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
      { onSuccess: () => toast.success("Frota criada"), onError: fail },
    );
  };

  if (authLoading || isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">A carregar…</div>;
  }

  if (!user) {
    return (
      <div className="p-6 space-y-3 max-w-md mx-auto text-center">
        <p className="font-semibold">Precisa de entrar na conta.</p>
        <Link to="/login" className="text-primary hover:underline text-sm">
          Ir para a entrada
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
          <h1 className="text-xl font-bold">Registar frota</h1>
        </div>
        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              A frota gere os seus próprios motoristas e define os preços de
              entrega por bairro. Os preços definem-se a seguir, no painel.
            </p>
            <div className="space-y-2">
              <Label htmlFor="fnome">Nome da frota</Label>
              <Input
                id="fnome"
                value={fleetName}
                onChange={(e) => setFleetName(e.target.value)}
                placeholder="Ex.: Transportes Bandim"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ftel">Telefone de contacto</Label>
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
              Criar frota
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
          <p className="text-xs text-muted-foreground">Painel da frota</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Metric label="Entregas" value={metrics.entregas} />
        <Metric label="Concluídas" value={metrics.concluidas} />
        <Metric label="Motoristas activos" value={`${metrics.motoristas_activos}/${metrics.motoristas}`} />
        <Metric label="Valor das entregas" value={formatCFA(metrics.valor_entregas)} />
      </div>

      <Tabs defaultValue="motoristas">
        <TabsList className="w-full">
          <TabsTrigger value="motoristas" className="flex-1">Motoristas</TabsTrigger>
          <TabsTrigger value="precos" className="flex-1">Preços</TabsTrigger>
        </TabsList>

        {/* ── Motoristas (§12) ─────────────────────────────────────────── */}
        <TabsContent value="motoristas" className="space-y-3 mt-3">
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="text-sm font-semibold">Adicionar motorista</p>
              <p className="text-xs text-muted-foreground">
                A conta é criada aqui. O motorista não precisa de se registar
                antes — recebe um PIN e entra com o telefone dele.
              </p>
              <div className="space-y-2">
                <Label htmlFor="nome">Nome</Label>
                <Input
                  id="nome"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nome do motorista"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tel">Telefone</Label>
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
                {addDriver.isPending ? "A criar…" : "Criar motorista"}
              </Button>
            </CardContent>
          </Card>

          {pinNovo && (
            <Card className="border-primary/40 bg-primary/5">
              <CardContent className="p-4 space-y-2">
                <p className="text-sm font-semibold">{pinNovo.nome} — PIN de entrada</p>
                <p className="text-4xl font-bold tracking-widest text-primary tabular-nums">
                  {pinNovo.pin}
                </p>
                <p className="text-xs text-muted-foreground">
                  Passa este PIN ao motorista. Ele entra com o telefone{" "}
                  <span className="font-medium">{pinNovo.telefone}</span> e este código.
                  Só aparece aqui uma vez — anota-o antes de fechar.
                </p>
                <Button variant="outline" size="sm" onClick={() => setPinNovo(null)}>
                  Já anotei
                </Button>
              </CardContent>
            </Card>
          )}

          {drivers.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              Ainda não há motoristas nesta frota.
            </p>
          )}

          {drivers.map((d) => (
            <Card key={d.id}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Bike className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold truncate">{d.name}</p>
                  <p className="text-xs text-muted-foreground">{d.phone}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {d.concluidas}/{d.entregas} entregas · {formatCFA(d.valor_entregas)}
                  </p>
                </div>
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
                    {d.is_available ? "Activo" : "Inactivo"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeDriver.mutate(d.id, { onError: fail })}
                  >
                    <Trash2 className="h-4 w-4 mr-1" /> Remover
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
              <p className="text-sm font-semibold">Definir preço de um bairro</p>
              <p className="text-xs text-muted-foreground">
                O preço é por bairro, não por distância. O cliente vê-o antes de
                confirmar o pedido.
              </p>
              <div className="space-y-2">
                <Label htmlFor="bairro">Bairro</Label>
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
                <Label htmlFor="preco">Preço (FCFA)</Label>
                <Input
                  id="preco"
                  inputMode="numeric"
                  value={preco}
                  onChange={(e) => setPreco(e.target.value)}
                  placeholder="1000"
                />
              </div>
              <Button onClick={onSavePrice} disabled={upsertPrice.isPending} className="w-full h-12">
                Guardar preço
              </Button>
            </CardContent>
          </Card>

          {prices.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              Sem preços definidos. Sem preço num bairro, a frota não recebe
              entregas para lá.
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
      </Tabs>
    </div>
  );
};

export default FleetDashboard;
