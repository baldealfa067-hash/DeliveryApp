import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

type Props = { src: string; alt: string };

export const ImagePreviewModal = ({ src, alt }: Props) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <img
        src={src}
        alt={alt}
        className="h-14 w-14 rounded-lg object-cover shrink-0 cursor-pointer active:scale-95 transition-transform"
        onClick={() => setOpen(true)}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="p-0 border-0 bg-transparent max-w-[90vw] w-auto shadow-none">
          <img
            src={src}
            alt={alt}
            className="max-h-[80vh] max-w-full rounded-lg object-contain mx-auto"
          />
        </DialogContent>
      </Dialog>
    </>
  );
};
