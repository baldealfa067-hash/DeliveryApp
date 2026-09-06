import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useDriverProfile } from "@/hooks/useDrivers";

/**
 * Guarda da área de cliente: explorar, restaurantes, carrinho, pedidos.
 *
 * Um restaurante ou um motorista não pedem comida a partir da conta de
 * trabalho — quem quiser as duas coisas cria contas separadas. Cada um é
 * mandado para o seu próprio painel em vez de ver a interface do outro.
 *
 * Fica de fora de propósito: conversas, mensagens, notificações e perfil.
 * Essas são partilhadas — o restaurante fala com os clientes por lá, e
 * fechá-las tirava-lhe funcionalidade que hoje tem.
 *
 * Visitante sem sessão continua a poder explorar: a conta só é exigida na
 * altura de encomendar.
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
