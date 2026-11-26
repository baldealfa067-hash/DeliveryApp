import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LoadError } from "@/components/LoadError";
import { useRestaurantTeamAccess } from "@/hooks/useRestaurantTeamAccess";

export function RestaurantTeamGate({ userId, redirectTo, children }: {
  userId: string;
  redirectTo: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const access = useRestaurantTeamAccess(userId);
  if (access.isError) return <LoadError onRetry={() => void access.refetch()} />;
  if (access.isPending) return <p role="status" className="p-4">{t("common.loading")}</p>;
  if (!access.data) return <Navigate to={redirectTo} replace />;
  return <>{children}</>;
}
