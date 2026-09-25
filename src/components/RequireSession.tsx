import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

/**
 * Guarda de rota que só exige sessão, sem papel.
 *
 * Para as rotas que não podem exigir um papel porque é nelas que o papel nasce —
 * /painel-frota: o papel `fleet` só existe depois de create_fleet(), chamada a
 * partir desse ecrã. Sem sessão, porém, não há nada a fazer lá: o ecrã montava,
 * as RPCs da frota respondiam 401 e ficava preso em "A carregar..." enquanto a
 * consulta repetia. Agora vai para o login antes de montar, como o RequireRole.
 */
const RequireSession = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  return <>{children}</>;
};

export default RequireSession;
