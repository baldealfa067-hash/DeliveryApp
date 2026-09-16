import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, FileText, Loader2, MapPin, Package, PackageOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { VoiceRecorderField } from "@/components/VoiceRecorderField";
import { useAuth } from "@/hooks/useAuth";
import { useBairros } from "@/hooks/useBairros";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useDeliveryPrice, useCreateSendOrder, type TipoEnvio } from "@/hooks/useSendOrder";
import { formatCFA } from "@/lib/format";

/**
 * Enviar um documento ou objecto (§19).
 *
 * A ORDEM DO ECRÃ segue a ordem da decisão, não a da base de dados: o quê,
 * de onde, para onde, quanto custa, confirmar. O preço aparece **antes** do
 * botão e depende só do bairro de destino — §14 diz que o cliente aceita um
 * preço, e §83 que não pode haver surpresas no fim.
 *
 * As DUAS gravações de voz não são decoração. Num envio a origem é escolhida
 * pelo cliente e é muitas vezes o sítio mais difícil de explicar por escrito —
 * "a casa a seguir à bomba, pergunta pelo Sr. Mané". §21 põe a voz acima do
 * mapa, e §78 diz que uma referência local vale mais que um número de porta.
 *
 * O GPS é capturado em silêncio quando o cliente deixa (§21), e a sua ausência
 * não bloqueia nada: desde 2026-09-16 a entrega existe com ou sem coordenadas.
 */
const TIPOS: { valor: TipoEnvio; rotulo: string; icone: typeof FileText }[] = [
  { valor: "documento", rotulo: "Documento", icone: FileText },
  { valor: "objeto", rotulo: "Objeto", icone: Package },
  { valor: "outro", rotulo: "Outro", icone: PackageOpen },
];

const SendPage = () => {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { data: bairros = [] } = useBairros();
  const geo = useGeolocation();
  const criar = useCreateSendOrder();

  const [tipo, setTipo] = useState<TipoEnvio>("documento");
  const [descricao, setDescricao] = useState("");
  const [recolhaMorada, setRecolhaMorada] = useState("");
  const [recolhaBairro, setRecolhaBairro] = useState<string>("");
  const [recolhaVoz, setRecolhaVoz] = useState<string | null>(null);
  const [destinoMorada, setDestinoMorada] = useState("");
  const [destinoBairro, setDestinoBairro] = useState<string>("");
  const [destinoVoz, setDestinoVoz] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");

  const { data: preco, isLoading: aCarregarPreco } = useDeliveryPrice(destinoBairro || null);

  useEffect(() => {
    if (!loading && !user) navigate("/login", { replace: true });
  }, [user, loading, navigate]);

  // Preenche nome e telefone do perfil, para não os pedir outra vez.
  useEffect(() => {
    if (!user?.id) return;
    void (async () => {
      const { data } = await supabase
        .from("profiles").select("name, phone").eq("user_id", user.id).maybeSingle();
      if (data?.name && !nome) setNome(data.name);
      if (data?.phone && !telefone) setTelefone(data.phone);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // GPS em silêncio (§21). Vale como origem: quem envia está quase sempre no
  // ponto de recolha quando faz o pedido.
  const detectarGps = geo.detect;
  useEffect(() => { detectarGps(); }, [detectarGps]);

  const podeEnviar = useMemo(
    () => recolhaMorada.trim() && destinoMorada.trim() && destinoBairro && telefone.trim() && preco,
    [recolhaMorada, destinoMorada, destinoBairro, telefone, preco],
  );

  const submeter = () => {
    if (!preco) {
      toast.error("Escolha um bairro de destino que tenha entrega.");
      return;
    }
    criar.mutate(
      {
        tipo, descricao,
        recolhaMorada: recolhaMorada.trim(),
        recolhaBairro: recolhaBairro || null,
        recolhaVoz,
        recolhaLat: geo.position?.lat ?? null,
        recolhaLng: geo.position?.lng ?? null,
        destinoMorada: destinoMorada.trim(),
        destinoBairro,
        destinoVoz,
        destinoLat: null, destinoLng: null,
        nome: nome.trim() || "Cliente",
        telefone: telefone.trim(),
      },
      {
        onSuccess: (r) => {
          toast.success(r.repetido ? "Este envio já tinha sido criado." : `Envio #${r.order_number} criado.`);
          navigate(`/pedido/${r.order_id}`);
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>;
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-6 pb-8 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Voltar">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">Enviar</h1>
          <p className="text-xs text-muted-foreground">Documentos e objetos, de um ponto a outro.</p>
        </div>
      </div>

      {/* 1. O quê */}
      <Card><CardContent className="p-4 space-y-3">
        <Label>O que vai enviar?</Label>
        <div className="grid grid-cols-3 gap-2">
          {TIPOS.map(({ valor, rotulo, icone: Icone }) => (
            <Button key={valor} type="button" variant={tipo === valor ? "default" : "outline"}
              className="h-16 flex-col gap-1" onClick={() => setTipo(valor)}>
              <Icone className="h-5 w-5" />
              <span className="text-xs">{rotulo}</span>
            </Button>
          ))}
        </div>
        <Textarea placeholder="Descreva em poucas palavras (opcional)"
          value={descricao} onChange={(e) => setDescricao(e.target.value)} className="min-h-16" />
      </CardContent></Card>

      {/* 2. De onde */}
      <Card><CardContent className="p-4 space-y-3">
        <Label className="flex items-center gap-2"><MapPin className="h-4 w-4" />Onde recolher</Label>
        <Input className="h-12" placeholder="Ex: Mercado de Bandim, banca do Sr. Mané"
          value={recolhaMorada} onChange={(e) => setRecolhaMorada(e.target.value)} />
        <Select value={recolhaBairro} onValueChange={setRecolhaBairro}>
          <SelectTrigger className="h-12"><SelectValue placeholder="Bairro de recolha (opcional)" /></SelectTrigger>
          <SelectContent>
            {bairros.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
          </SelectContent>
        </Select>
        <VoiceRecorderField
          titulo="Indicação de voz da recolha"
          ajuda="Explique onde é. Referências valem mais que a morada."
          valor={recolhaVoz} aoMudar={setRecolhaVoz} pasta="envios/recolha"
        />
      </CardContent></Card>

      {/* 3. Para onde — é este bairro que decide o preço */}
      <Card><CardContent className="p-4 space-y-3">
        <Label className="flex items-center gap-2"><MapPin className="h-4 w-4" />Onde entregar</Label>
        <Input className="h-12" placeholder="Ex: Safim, casa azul depois da bomba"
          value={destinoMorada} onChange={(e) => setDestinoMorada(e.target.value)} />
        <Select value={destinoBairro} onValueChange={setDestinoBairro}>
          <SelectTrigger className="h-12"><SelectValue placeholder="Bairro de destino" /></SelectTrigger>
          <SelectContent>
            {bairros.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
          </SelectContent>
        </Select>
        <VoiceRecorderField
          titulo="Indicação de voz da entrega"
          ajuda="Como chegar, e por quem perguntar."
          valor={destinoVoz} aoMudar={setDestinoVoz} pasta="envios/entrega"
        />
      </CardContent></Card>

      {/* 4. Contacto */}
      <Card><CardContent className="p-4 space-y-2">
        <Label>Contacto</Label>
        <Input className="h-12" placeholder="O seu nome" value={nome}
          onChange={(e) => setNome(e.target.value)} />
        <Input className="h-12" inputMode="tel" placeholder="Telefone (o motorista vai ligar)"
          value={telefone} onChange={(e) => setTelefone(e.target.value)} />
      </CardContent></Card>

      {/* 5. O preço, ANTES do botão (§14, §83) */}
      <Card className={preco ? "border-primary/30 bg-primary/5" : undefined}>
        <CardContent className="p-4">
          {!destinoBairro ? (
            <p className="text-sm text-muted-foreground">Escolha o bairro de destino para ver o preço.</p>
          ) : aCarregarPreco ? (
            <p className="text-sm text-muted-foreground">A consultar o preço…</p>
          ) : preco ? (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm text-muted-foreground">Preço da entrega</span>
                <span className="text-2xl font-bold">{formatCFA(preco.preco)}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Por {preco.fleet_name}. Paga ao motorista na entrega.
              </p>
            </>
          ) : (
            <p className="text-sm text-destructive">
              Ainda não há nenhuma frota a entregar em {destinoBairro}.
            </p>
          )}
        </CardContent>
      </Card>

      <Button className="w-full h-14 text-base" disabled={!podeEnviar || criar.isPending}
        onClick={submeter}>
        {criar.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        {preco ? `Confirmar envio — ${formatCFA(preco.preco)}` : "Confirmar envio"}
      </Button>
    </div>
  );
};

export default SendPage;
