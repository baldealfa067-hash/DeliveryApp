import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Fase 3 — Frotas.
 *
 * As RPCs desta fase ainda não constam de `src/integrations/supabase/types.ts`,
 * que é gerado a partir do esquema. Regenerar os tipos depois de as migrações
 * estarem todas aplicadas; até lá este wrapper isola o cast num sítio só, em
 * vez de o espalhar por cada chamada.
 */
const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export interface FleetMetrics {
  fleet_id: string;
  fleet_name: string;
  motoristas: number;
  motoristas_activos: number;
  entregas: number;
  concluidas: number;
  pendentes: number;
  valor_entregas: number;
}

export interface FleetDriver {
  id: string;
  name: string;
  phone: string;
  vehicle_type: string;
  is_available: boolean;
  entregas: number;
  concluidas: number;
  valor_entregas: number;
}

export interface ZonePrice {
  id: string;
  bairro: string;
  preco: number;
  is_active: boolean;
}

const unwrap = <T,>(data: unknown, error: { message: string } | null): T => {
  if (error) throw new Error(error.message);
  return data as T;
};

/** §32 — os números do painel da frota. Calculados na hora, não há saldo guardado (§39). */
export const useFleetMetrics = () =>
  useQuery({
    queryKey: ["fleet", "metrics"],
    queryFn: async () => {
      const { data, error } = await rpc("get_fleet_metrics");
      const rows = unwrap<FleetMetrics[]>(data, error);
      return rows?.[0] ?? null;
    },
  });

/** §12 — a frota vê os seus motoristas, e só os seus (o filtro é no servidor). */
export const useFleetDrivers = () =>
  useQuery({
    queryKey: ["fleet", "drivers"],
    queryFn: async () => {
      const { data, error } = await rpc("get_fleet_drivers");
      return unwrap<FleetDriver[]>(data, error) ?? [];
    },
  });

/** §13 — a grelha de preços por bairro desta frota. RLS trata do isolamento. */
export const useZonePrices = (fleetId: string | null) =>
  useQuery({
    queryKey: ["fleet", "zonePrices", fleetId],
    enabled: !!fleetId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fleet_zone_prices" as never)
        .select("id, bairro, preco, is_active")
        .order("bairro");
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as ZonePrice[];
    },
  });

export const useCreateFleet = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { name: string; phone: string; bairro?: string }) => {
      const { data, error } = await rpc("create_fleet", {
        p_name: p.name,
        p_phone: p.phone,
        p_bairro: p.bairro ?? null,
      });
      return unwrap<string>(data, error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fleet"] }),
  });
};

export interface DriverCreated {
  driverId: string;
  /** PIN gerado, para a frota passar ao motorista. `null` se a conta já existia. */
  pin: string | null;
  jaTinhaConta: boolean;
  telefone: string;
}

/**
 * §11 — a frota cadastra os seus motoristas.
 *
 * A conta do motorista é criada pela frota, não por ele: a Edge Function
 * `fleet-create-driver` usa a API de administração (a única via suportada para
 * criar contas em `auth.users`) e devolve um PIN gerado. Antes exigia-se que o
 * motorista se registasse sozinho primeiro — um passo a mais, e a frota ficava
 * à espera dele.
 *
 * Se o telefone já tiver conta, nada é criado e `pin` vem `null`: essa pessoa
 * entra com o PIN que já tem.
 */
export const useAddDriver = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { phone: string; name: string; vehicleType?: string }) => {
      const { data, error } = await supabase.functions.invoke("fleet-create-driver", {
        body: { name: p.name, phone: p.phone, vehicleType: p.vehicleType ?? "moto" },
      });
      // A Edge Function devolve {error} no corpo com estado 4xx; o supabase-js
      // embrulha isso num FunctionsHttpError cuja mensagem não diz nada de útil.
      // Lê-se o corpo para a frota ver a razão real.
      if (error) {
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.json === "function") {
          try {
            const corpo = await ctx.json();
            if (corpo?.error) throw new Error(corpo.error);
          } catch (e) {
            if (e instanceof Error && e.message) throw e;
          }
        }
        throw new Error(error.message ?? "Não foi possível criar o motorista");
      }
      if ((data as { error?: string })?.error) {
        throw new Error((data as { error: string }).error);
      }
      return data as DriverCreated;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fleet"] }),
  });
};

/**
 * Gera um PIN novo para um motorista da frota.
 *
 * O PIN não é guardado em lado nenhum — é derivado do telefone + PIN. Portanto
 * não há "ver o PIN outra vez": só gerar outro, que invalida o anterior.
 */
export const useResetDriverPin = () => {
  return useMutation({
    mutationFn: async (driverId: string) => {
      const { data, error } = await supabase.functions.invoke("fleet-reset-driver-pin", {
        body: { driverId },
      });
      if (error) {
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.json === "function") {
          try {
            const corpo = await ctx.json();
            if (corpo?.error) throw new Error(corpo.error);
          } catch (e) {
            if (e instanceof Error && e.message) throw e;
          }
        }
        throw new Error(error.message ?? "Não foi possível gerar um PIN novo");
      }
      if ((data as { error?: string })?.error) {
        throw new Error((data as { error: string }).error);
      }
      return data as { pin: string; telefone: string; nome: string | null };
    },
  });
};

export const useSetDriverActive = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { driverId: string; active: boolean }) => {
      const { error } = await rpc("set_driver_active", {
        p_driver_id: p.driverId,
        p_active: p.active,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fleet"] }),
  });
};

/** Larga o vínculo, não apaga o motorista nem o histórico de entregas (§56). */
export const useRemoveDriver = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (driverId: string) => {
      const { error } = await rpc("remove_driver_from_fleet", { p_driver_id: driverId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fleet"] }),
  });
};

export const useUpsertZonePrice = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { bairro: string; preco: number }) => {
      const { error } = await rpc("upsert_zone_price", {
        p_bairro: p.bairro,
        p_preco: p.preco,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fleet", "zonePrices"] }),
  });
};

export interface DriverDetail {
  driver_id: string;
  nome: string;
  resumo: {
    entregas: number;
    concluidas: number;
    canceladas: number;
    em_curso: number;
    ganhos: number;
    /** Minutos entre aceitar e entregar. `null` até haver uma entrega concluída
     *  — não se devolve 0, que afirmaria rapidez que não se mediu (§84). */
    minutos_medios: number | null;
  };
  bairros: Array<{ bairro: string; entregas: number; ganhos: number }>;
  horas: Array<{ hora: number; entregas: number }>;
  ultimas: Array<{
    order_number: number;
    bairro: string | null;
    estado: string;
    taxa: number | null;
    aceite_em: string | null;
    entregue_em: string | null;
  }>;
}

/**
 * Detalhe de um motorista da frota (§12, §32).
 *
 * Só o dono da frota a que o motorista pertence — a RPC compara `owner_user_id`
 * com o `auth.uid()` de quem chama. O próprio motorista é recusado: §12 nega-lhe
 * acesso administrativo à frota.
 */
export const useDriverDetail = (driverId: string | null) =>
  useQuery({
    queryKey: ["fleet", "driverDetail", driverId],
    enabled: !!driverId,
    queryFn: async () => {
      const { data, error } = await rpc("get_fleet_driver_detail", {
        p_driver_id: driverId,
      });
      return unwrap<DriverDetail>(data, error);
    },
  });

/**
 * §14/§83 — o cliente tem de saber o preço da entrega ANTES de confirmar.
 * Devolve só o valor aplicável; a grelha de preços de cada frota é privada.
 */
export const useDeliveryPrice = (bairro: string | null) =>
  useQuery({
    queryKey: ["deliveryPrice", bairro],
    enabled: !!bairro,
    queryFn: async () => {
      const { data, error } = await rpc("get_delivery_price", { p_bairro: bairro });
      const rows = unwrap<Array<{ fleet_id: string; fleet_name: string; preco: number }>>(
        data,
        error,
      );
      return rows?.[0] ?? null;
    },
  });
