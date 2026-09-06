import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import type { AppRole } from "@/hooks/useAuth";

/**
 * Guarda de rota por papel.
 *
 * Existe porque esconder a ligação na navegação não é proteger: /painel-loja e
 * /painel-motorista eram alcançáveis escrevendo o URL, e a única barreira era
 * uma verificação dentro do próprio ecrã, que já chegava tarde — o componente
 * montava, corria as queries e só depois redirecionava.
 *
 * Cada tipo de conta só vê a sua interface. Quem quiser outro papel cria uma
 * conta separada desse tipo.
 */
const RequireRole = ({
  roles,
  children,
  redirectTo = "/inicio",
}: {
  roles: AppRole[];
  children: React.ReactNode;
  redirectTo?: string;
}) => {
  const { user, roles: userRoles, rolesLoaded, loading } = useAuth();

  if (loading || (user && !rolesLoaded)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  // Admin passa em qualquer painel — precisa disso para dar apoio.
  const permitido = userRoles.includes("admin") || roles.some((r) => userRoles.includes(r));
  if (!permitido) return <Navigate to={redirectTo} replace />;

  return <>{children}</>;
};

export default RequireRole;
