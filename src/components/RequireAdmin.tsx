import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";

const RequireAdmin = ({ children }: { children: React.ReactNode }) => {
  const { user, isAdmin, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/inicio" replace />;

  return <>{children}</>;
};

export default RequireAdmin;
