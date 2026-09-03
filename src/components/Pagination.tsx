import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  total: number;
}

export const Pagination = ({ page, pageCount, onPageChange, total }: PaginationProps) => {
  const { t } = useTranslation();
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
      <p className="text-xs text-muted-foreground">{total === 1 ? t("pagination.result", { count: total }) : t("pagination.results", { count: total })}</p>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label={t("pagination.prev")}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm text-muted-foreground px-2">
          {page} / {pageCount}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
          aria-label={t("pagination.next")}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};