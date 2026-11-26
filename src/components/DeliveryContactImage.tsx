import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ImagePlus, Phone } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

const bucket = () => supabase.storage.from("delivery-contact-images");
const fileTypes = ["image/jpeg", "image/png", "image/webp"];

async function imageUrl(path: string) {
  const { data } = await bucket().createSignedUrl(path, 120);
  return data?.signedUrl ?? null;
}

export function DeliveryContactImageUpload({ kind, id }: { kind: "fleet" | "driver"; id: string }) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const path = `${kind}/${id}`;
  const image = useQuery({
    queryKey: ["delivery-contact-image", path],
    queryFn: () => imageUrl(path),
    refetchInterval: 60000,
  });

  const upload = async (file: File) => {
    if (!fileTypes.includes(file.type) || file.size > 5 * 1024 * 1024 || !file.size) {
      toast.error(t("deliveryContactImage.invalidFile"));
      return;
    }
    setUploading(true);
    try {
      const { error } = await bucket().upload(path, file, {
        upsert: true, contentType: file.type, cacheControl: "0",
      });
      if (error) throw error;
      await image.refetch();
      toast.success(t("deliveryContactImage.saved"));
    } catch {
      toast.error(t("deliveryContactImage.failed"));
    } finally {
      setUploading(false);
    }
  };

  const label = t(kind === "fleet" ? "deliveryContactImage.fleetLogo" : "deliveryContactImage.driverPhoto");
  return (
    <div className="flex items-center gap-3">
      {image.data && <img src={image.data} alt="" className="h-12 w-12 rounded-lg border bg-background object-contain" />}
      <input ref={inputRef} type="file" accept={fileTypes.join(",")} className="sr-only"
        disabled={uploading} tabIndex={-1} aria-label={label} onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (file) void upload(file);
      }} />
      <Button type="button" variant="outline" size="sm" disabled={uploading}
        onClick={() => inputRef.current?.click()}>
        <ImagePlus className="mr-2 h-4 w-4" />
        {uploading ? t("common.loading") : label}
      </Button>
    </div>
  );
}

export function DeliveryDriverContactIcon({ orderId, contact }: { orderId: string; contact: string }) {
  const image = useQuery({
    queryKey: ["order-delivery-contact-image", orderId, contact],
    queryFn: async () => {
      const { data } = await supabase.rpc("get_delivery_contact_image", { p_order_id: orderId });
      return data ? imageUrl(data) : null;
    },
    refetchInterval: 60000,
  });
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return image.data && failedUrl !== image.data ? (
    <img src={image.data} alt="" onError={() => setFailedUrl(image.data ?? null)}
      className="h-10 w-10 shrink-0 rounded-lg border bg-background object-contain" />
  ) : <Phone className="h-5 w-5 shrink-0" />;
}
