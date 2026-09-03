import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "react-i18next";

interface ClientSignupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export const ClientSignupDialog = ({ open, onOpenChange, onSuccess }: ClientSignupDialogProps) => {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error(t("auth.enterName"));
    if (!phone.trim()) return toast.error(t("auth.enterPhone"));

    setSubmitting(true);
    try {
      const cleanPhone = phone.replace(/\s+/g, "").replace(/^0+/, "");
      const email = `c${cleanPhone}@bornaal.cv`;
      const password = `Bn${Date.now().toString(36)}!`;

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name: name.trim(), phone: cleanPhone },
        },
      });

      if (error || !data.user) {
        return toast.error(error?.message ?? t("auth.registerError"));
      }

      if (data.session) {
        const { error: roleErr } = await supabase.rpc("register_as_client");
        if (roleErr) console.error("Role error:", roleErr);
      }

      toast.success(t("auth.accountCreated"));
      setName("");
      setPhone("");
      onSuccess();
    } catch {
      toast.error(t("auth.registerError"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            {t("auth.clientSignupTitle")}
          </DialogTitle>
          <DialogDescription>{t("auth.clientSignupDesc")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label htmlFor="signup-name">{t("auth.name")}</Label>
            <Input
              id="signup-name"
              placeholder={t("auth.namePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="signup-phone">{t("auth.phone")}</Label>
            <Input
              id="signup-phone"
              type="tel"
              placeholder={t("auth.phonePlaceholder")}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1.5"
            />
          </div>
          <Button type="submit" disabled={submitting} className="w-full gap-2">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            {submitting ? t("auth.creatingAccount") : t("auth.createClientAccount")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};
