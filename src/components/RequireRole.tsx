import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
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
 *
 * Papéis por confirmar (query ainda a correr ou falhada) nunca redireccionam:
 * redirecionar com roles vazias por engano mandava admins e clientes para
 * /perfil. Enquanto não há confirmação, mostra-se espera ou erro com retry.
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
  const { t } = useTranslation();
  const { user, roles: userRoles, rolesLoaded, rolesError, retryRoles, loading } = useAuth();

  if (loading || (user && !rolesLoaded)) {
    if (user && rolesError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
          <p className="text-muted-foreground">{t("common.errorLoading")}</p>
          <Button variant="outline" onClick={retryRoles}>
            {t("common.tryAgain")}
          </Button>
        </div>
      );
    }
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
