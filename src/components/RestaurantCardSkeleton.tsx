import { Skeleton } from "@/components/ui/skeleton";

/**
 * Esqueleto com a forma exata do RestaurantCard (§7 do plano): blocos cinzentos
 * em vez de um spinner ao centro. A lista não muda de altura ao chegar os dados.
 */
export const RestaurantCardSkeleton = () => (
  <div className="overflow-hidden rounded-lg border bg-card shadow-soft">
    <Skeleton className="aspect-video w-full rounded-none" />
    <div className="flex items-center gap-3 px-4 py-3">
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-12" />
    </div>
  </div>
);
