import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Esqueleto com a forma exata do ProviderCard (§7): blocos cinzentos em vez de
 * um spinner ao centro. A lista não muda de altura quando os dados chegam.
 */
export const ProviderCardSkeleton = () => (
  <Card className="overflow-hidden shadow-soft">
    <Skeleton className="aspect-video w-full rounded-none" />
    <div className="flex items-start gap-3 p-4">
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <div className="flex shrink-0 flex-col gap-2">
        <Skeleton className="h-12 w-12 rounded-md" />
        <Skeleton className="h-12 w-12 rounded-md" />
      </div>
    </div>
  </Card>
);
