import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  /** "problem" pinta o ícone com a cor de erro; o texto continua a dizer o que se passa. */
  tone?: "neutral" | "problem";
}

/**
 * Estado vazio ou de erro (§7): ícone + frase clara + ação.
 * Nunca códigos técnicos, e um erro tem sempre saída — "Tentar de novo".
 */
export const EmptyState = ({ icon: Icon, title, description, action, tone = "neutral" }: EmptyStateProps) => (
  <div className="flex flex-col items-center px-6 py-12 text-center">
    <div
      className={cn(
        "flex h-16 w-16 items-center justify-center rounded-full",
        tone === "problem" ? "bg-problem-soft" : "bg-muted"
      )}
    >
      <Icon
        className={cn("h-7 w-7", tone === "problem" ? "text-problem-foreground" : "text-muted-foreground")}
        aria-hidden="true"
      />
    </div>
    <p className="mt-4 text-title text-foreground">{title}</p>
    {description && <p className="mt-1.5 max-w-xs text-body text-muted-foreground">{description}</p>}
    {action && (
      <Button onClick={action.onClick} className="mt-5 h-12 px-6 text-body font-semibold">
        {action.label}
      </Button>
    )}
  </div>
);
