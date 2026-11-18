import { useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Props = { src: string; alt: string; card?: boolean };

export const ImagePreviewModal = ({ src, alt, card }: Props) => {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" aria-label={alt} className={cn(
          "block shrink-0 overflow-hidden bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          card ? "aspect-[2/1] w-full" : "h-14 w-14 rounded-lg",
        )}>
          <img src={src} alt="" loading={card ? "lazy" : undefined} decoding="async"
            className="h-full w-full object-cover" />
        </button>
      </DialogTrigger>
      <DialogContent className="w-auto max-w-[90vw] border-0 bg-transparent p-0 shadow-none" aria-describedby={undefined}>
        <DialogTitle className="sr-only">{alt}</DialogTitle>
        <img src={src} alt={alt} className="mx-auto max-h-[80vh] max-w-full rounded-lg object-contain" />
      </DialogContent>
    </Dialog>
  );
};
