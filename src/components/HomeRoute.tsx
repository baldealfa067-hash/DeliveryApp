import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

/**
 * O ecrã de entrada (Entrar / Criar conta) é só para quem chega SEM sessão.
 * Com sessão vai directo a /inicio: um cliente que abra o site pelo endereço ou
 * pelo ícone da PWA não tem de atravessar um ecrã que já não lhe serve. Contas
 * de trabalho nem chegam aqui — o RequireClientArea que envolve estas rotas
 * manda-as antes para o seu painel.
 */
const HomeRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (user) return <Navigate to="/inicio" replace />;
  return <>{children}</>;
};

export default HomeRoute;
