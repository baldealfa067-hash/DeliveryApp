import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ConfirmDialogInput {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
}

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  input?: ConfirmDialogInput;
  onConfirm: () => void;
}

const ConfirmDialog = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive,
  busy,
  input,
  onConfirm,
}: ConfirmDialogProps) => {
  const { t } = useTranslation();
  const _confirmLabel = confirmLabel ?? t("common.confirm");
  const _cancelLabel = cancelLabel ?? t("common.cancel");
  return (
  <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>
      {input && (
        <div className="space-y-1.5">
          <Label>{input.label}</Label>
          {input.multiline ? (
            <Textarea
              value={input.value}
              onChange={(e) => input.onChange(e.target.value)}
              placeholder={input.placeholder}
              autoFocus
            />
          ) : (
            <Input
              value={input.value}
              onChange={(e) => input.onChange(e.target.value)}
              placeholder={input.placeholder}
              autoFocus
            />
          )}
        </div>
      )}
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
          {_cancelLabel}
        </Button>
        <Button
          variant={destructive ? "destructive" : "default"}
          disabled={busy || (input?.required ? !input.value.trim() : false)}
          onClick={onConfirm}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {_confirmLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
  );
};

export default ConfirmDialog;