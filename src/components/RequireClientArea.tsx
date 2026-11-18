import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Navigate } from "react-router-dom";
import { LoadError } from "@/components/LoadError";
import { useAuth } from "@/hooks/useAuth";
import { getPostLoginDestination } from "@/lib/getPostLoginDestination";

/** Selects the default destination on the landing routes. Public routes such
 * as /inicio and /meus-pedidos remain available to every account. */
const RequireClientArea = ({ children }: { children: React.ReactNode }) => {
  const { user, roles, rolesLoaded, rolesError, retryRoles, loading, sessionError, retrySession } = useAuth();
  const destination = useQuery({
    queryKey: ["post-login-destination", user?.id, roles],
    enabled: !!user && rolesLoaded && !loading,
    queryFn: () => getPostLoginDestination(user!.id, roles),
  });

  if (sessionError) return <LoadError onRetry={retrySession} />;

  if (user && rolesError) return <LoadError onRetry={retryRoles} />;
  if (user && destination.isError) return <LoadError onRetry={() => void destination.refetch()} />;
  if (loading || (user && (!rolesLoaded || !destination.data))) {
    return (
      <div role="status" className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (user && destination.data) return <Navigate to={destination.data} replace />;
  return <>{children}</>;
};

export default RequireClientArea;
