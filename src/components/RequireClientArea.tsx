import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useDriverProfile } from "@/hooks/useDrivers";

/**
 * Escolhe o destino por omissão de quem tem conta de trabalho: raiz do site e
 * área de pedidos pessoais. Manda restaurantes e motoristas para o seu painel,
 * que é o que quase sempre querem ao abrir a app.
 *
 * NÃO é uma guarda de navegação. /inicio, /explorar e /loja/:id são conteúdo
 * para ver e estão abertos a qualquer conta — um dono de restaurante tem de
 * poder olhar à volta como qualquer pessoa. Já esteve a envolver essas rotas e
 * bloqueava-as; foi retirado de lá de propósito, não voltar a pôr.
 *
 * O isolamento a sério — o que impede um cliente de ver o painel de gestão de
 * um restaurante ou de um motorista — é o RequireRole, e é esse que não se
 * mexe.
 *
 * Fica de fora de propósito: conversas, mensagens, notificações e perfil.
 * Essas são partilhadas — o restaurante fala com os clientes por lá, e
 * fechá-las tirava-lhe funcionalidade que hoje tem.
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
