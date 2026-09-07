import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useDriverProfile } from "@/hooks/useDrivers";

/**
 * Escolhe o destino por omissão na raiz do site, e mais nada.
 *
 * Quem tem conta de trabalho e abre a app pelo endereço ou pelo ícone da PWA
 * quer quase sempre o seu painel, por isso é para lá que vai. É uma
 * conveniência, não uma barreira.
 *
 * NÃO é uma guarda. Apesar do nome, não há "área de cliente": navegar, ver
 * menus, pedir e acompanhar (/inicio, /explorar, /loja/:id, /meus-pedidos,
 * /pedido/:id) são a app pública e estão abertos a qualquer conta. Um dono de
 * restaurante encomenda o almoço como qualquer pessoa. Este componente já
 * esteve a envolver essas rotas e bloqueava-as — foi retirado de lá de
 * propósito, não voltar a pôr.
 *
 * O isolamento a sério — o que impede um cliente de ver o painel de gestão de
 * um restaurante ou de um motorista — é o RequireRole, e é esse que não se
 * mexe. Do lado do servidor a regra é a mesma: as RPCs de pedidos decidem por
 * posse (quem fez o pedido, quem é dono do restaurante, quem faz a entrega) e
 * nunca por tipo de conta.
 *
 * Visitante sem sessão passa sempre: a conta só é exigida ao encomendar.
 */
const RequireClientArea = ({ children }: { children: React.ReactNode }) => {
  const { user, isBusiness, rolesLoaded, loading } = useAuth();
  const { data: driver, isLoading: driverLoading } = useDriverProfile(user?.id ?? null);

  if (loading || (user && (!rolesLoaded || driverLoading))) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (user && isBusiness) return <Navigate to="/painel-loja" replace />;
  if (user && driver) return <Navigate to="/painel-motorista" replace />;

  return <>{children}</>;
};

export default RequireClientArea;
