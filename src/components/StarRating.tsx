import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface StarRatingProps {
  rating: number;
  onChange?: (rating: number) => void;
  size?: "sm" | "md";
}

export const StarRating = ({ rating, onChange, size = "sm" }: StarRatingProps) => {
  const starSize = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(star)}
          className={cn("transition-colors", onChange && "cursor-pointer hover:scale-110")}
        >
          <Star
            className={cn(
              starSize,
              star <= rating
                ? "fill-secondary text-secondary"
                : "fill-transparent text-muted-foreground/30"
            )}
          />
        </button>
      ))}
    </div>
  );
};
