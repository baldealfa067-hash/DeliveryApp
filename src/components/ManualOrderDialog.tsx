import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Minus, Plus, ShoppingBag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { formatCFA } from "@/lib/format";

/**
 * Lançar um pedido que não veio pela aplicação — telefone ou balcão (Fase 2.4).
 *
 * O ecrã mostra um total, mas esse total é só uma PRÉ-VISUALIZAÇÃO. Quem manda
 * é `create_manual_order`, que volta a somar a partir do menu e ignora qualquer
 * preço vindo daqui (§46, §83). Se os dois discordarem — porque alguém mexeu no
 * preço entretanto — é o do servidor que fica, e é o correcto.
 *
 * Só aparecem artigos `is_orderable`: ligados pelo dono E com stock. Deixar
 * lançar um prato esgotado só levava a RPC a recusar depois de tudo preenchido.
 */
interface ItemMenu {
  id: string;
  name: string;
  price: number;
  is_orderable: boolean;
  track_stock: boolean;
  stock_qty: number | null;
}

const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string, args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export const ManualOrderDialog = ({ businessId }: { businessId: string }) => {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [quantidades, setQuantidades] = useState<Record<string, number>>({});
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [modo, setModo] = useState<"comer_no_local" | "para_levar" | "entrega">("comer_no_local");
  const [bairro, setBairro] = useState("");
  const [morada, setMorada] = useState("");

  const { data: menu = [] } = useQuery({
    queryKey: ["menu-para-manual", businessId],
    enabled: aberto,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("menu_items")
        .select("id, name, price, is_orderable, track_stock, stock_qty")
        .eq("business_id", businessId)
        .order("name");
      if (error) throw new Error(error.message);
      return (data ?? []) as ItemMenu[];
    },
  });

  const disponiveis = useMemo(() => menu.filter((m) => m.is_orderable), [menu]);
  const totalPrevisto = useMemo(
    () => disponiveis.reduce((s, m) => s + m.price * (quantidades[m.id] ?? 0), 0),
    [disponiveis, quantidades],
  );
  const nArtigos = Object.values(quantidades).reduce((s, n) => s + n, 0);

  const limpar = () => {
    setQuantidades({}); setNome(""); setTelefone("");
    setModo("comer_no_local"); setBairro(""); setMorada("");
  };

  const criar = useMutation({
    mutationFn: async (concluir: boolean) => {
      const itens = Object.entries(quantidades)
        .filter(([, q]) => q > 0)
        .map(([menu_item_id, qty]) => ({ menu_item_id, qty }));
      if (itens.length === 0) throw new Error("Escolha pelo menos um artigo.");
      const { data, error } = await rpc("create_manual_order", {
        p_business_id: businessId,
        p_items: itens,
        p_consumption_option: modo,
        p_customer_name: nome || null,
        p_customer_phone: telefone || null,
        p_bairro: modo === "entrega" ? bairro || null : null,
        p_address: modo === "entrega" ? morada || null : null,
        p_concluir: concluir,
      });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["business"] });
      toast.success("Pedido lançado.");
      limpar();
      setAberto(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mudar = (id: string, delta: number) =>
    setQuantidades((q) => {
      const n = Math.max(0, (q[id] ?? 0) + delta);
      const novo = { ...q };
      if (n === 0) delete novo[id]; else novo[id] = n;
      return novo;
    });

  return (
    <Dialog open={aberto} onOpenChange={(o) => { setAberto(o); if (!o) limpar(); }}>
      <DialogTrigger asChild>
        <Button className="w-full h-12" variant="outline">
          <ShoppingBag className="h-4 w-4 mr-2" />
          Lançar pedido manual
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pedido por telefone ou balcão</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Artigos</Label>
            {disponiveis.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum artigo disponível. Verifique o menu e o stock.
              </p>
            ) : (
              disponiveis.map((m) => (
                <div key={m.id} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate">{m.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatCFA(m.price)}
                      {m.track_stock && ` · ${m.stock_qty} em stock`}
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0"
                    onClick={() => mudar(m.id, -1)} disabled={!quantidades[m.id]}>
                    <Minus className="h-4 w-4" />
                  </Button>
                  <span className="w-6 text-center text-sm tabular-nums">{quantidades[m.id] ?? 0}</span>
                  <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0"
                    onClick={() => mudar(m.id, 1)}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            {([
              ["comer_no_local", "No local"],
              ["para_levar", "Levar"],
              ["entrega", "Entrega"],
            ] as const).map(([v, t]) => (
              <Button key={v} type="button" variant={modo === v ? "default" : "outline"}
                className="h-11" onClick={() => setModo(v)}>
                {t}
              </Button>
            ))}
          </div>

          <div className="space-y-2">
            <Input placeholder="Nome do cliente (opcional)" className="h-11"
              value={nome} onChange={(e) => setNome(e.target.value)} />
            <Input placeholder="Telefone (opcional)" className="h-11" inputMode="tel"
              value={telefone} onChange={(e) => setTelefone(e.target.value)} />
            {modo === "entrega" && (
              <>
                <Input placeholder="Bairro (define o preço da entrega)" className="h-11"
                  value={bairro} onChange={(e) => setBairro(e.target.value)} />
                <Input placeholder="Onde entregar — referências valem mais que a morada" className="h-11"
                  value={morada} onChange={(e) => setMorada(e.target.value)} />
              </>
            )}
          </div>

          <div className="flex items-baseline justify-between border-t pt-3">
            <span className="text-sm text-muted-foreground">{nArtigos} artigo(s)</span>
            <span className="text-xl font-bold">{formatCFA(totalPrevisto)}</span>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            O total é confirmado pelo servidor a partir do menu. A taxa de
            entrega, quando houver, é somada depois pelo preço do bairro.
          </p>

          <div className="space-y-2">
            {modo !== "entrega" && (
              <Button className="w-full h-12" disabled={criar.isPending || nArtigos === 0}
                onClick={() => criar.mutate(true)}>
                {criar.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Lançar e concluir
              </Button>
            )}
            <Button variant={modo === "entrega" ? "default" : "outline"}
              className="w-full h-12" disabled={criar.isPending || nArtigos === 0}
              onClick={() => criar.mutate(false)}>
              {criar.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {modo === "entrega" ? "Lançar e procurar motorista" : "Lançar como em preparação"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Pedidos manuais não geram comissão da plataforma. O stock é
            descontado já, no momento em que lança.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};
