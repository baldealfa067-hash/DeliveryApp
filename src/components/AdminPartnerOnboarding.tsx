import { useState } from "react";
import type { FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/PhoneInput";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { derivePassword, isValidPhone, isValidPin, normalizePhone } from "@/lib/clientAuth";

type PartnerRole = "business" | "fleet" | "driver";
type ProvisionResult = { ok?: boolean; created?: boolean; needsPin?: boolean };

export const AdminPartnerOnboarding = ({ adminId, onSaved }: { adminId: string; onSaved: () => void }) => {
  const { t } = useTranslation();
  const [role, setRole] = useState<PartnerRole>("business");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [fleetId, setFleetId] = useState("independent");
  const [submitting, setSubmitting] = useState(false);
  const [needsPin, setNeedsPin] = useState(false);
  const fleets = useQuery({
    queryKey: ["admin-partner-fleets", adminId],
    enabled: role === "driver",
    queryFn: async () => {
      const { data, error } = await supabase.from("fleets").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting || !name.trim() || !isValidPhone(phone) || (!!pin && !isValidPin(pin))) return;
    setSubmitting(true);
    try {
      const number = normalizePhone(phone);
      const password = pin ? await derivePassword(number, pin) : undefined;
      const { data, error } = await supabase.functions.invoke<ProvisionResult>("admin-provision-partner", {
        body: { role, name: name.trim(), phone: number, password,
          fleetId: role === "driver" && fleetId !== "independent" ? fleetId : null },
      });
      if (error) {
        const response = "context" in error ? error.context : undefined;
        const payload = response instanceof Response ? await response.json().catch(() => null) : null;
        toast.error(payload?.error || t("admin.partnerCreateError"));
        return;
      }
      if (data?.needsPin) {
        setNeedsPin(true);
        return;
      }
      if (!data?.ok) throw new Error("Missing confirmation");
      toast.success(t(data.created ? "admin.partnerAccountCreated" : "admin.partnerActivated"));
      setName("");
      setPhone("");
      setPin("");
      setNeedsPin(false);
      void fleets.refetch();
      onSaved();
    } catch {
      toast.error(t("admin.partnerCreateError"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="max-w-xl">
      <CardContent className="p-4 sm:p-6">
        <form onSubmit={submit}>
          <fieldset disabled={submitting} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="partner-role">{t("admin.partnerType")}</Label>
              <Select value={role} onValueChange={(value) => setRole(value as PartnerRole)} disabled={submitting}>
                <SelectTrigger id="partner-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="business">{t("admin.restaurants")}</SelectItem>
                  <SelectItem value="fleet">{t("admin.notifFleets")}</SelectItem>
                  <SelectItem value="driver">{t("admin.notifDrivers")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="partner-name">{t("common.name")}</Label>
              <Input id="partner-name" value={name} required maxLength={100} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="partner-phone">{t("common.phone")}</Label>
              <PhoneInput id="partner-phone" value={phone} onChange={(e) => {
                setPhone(e.target.value);
                setNeedsPin(false);
                setPin("");
              }} />
            </div>
            {role === "driver" && (
              <div className="space-y-1">
                <Label htmlFor="partner-fleet">{t("admin.notifFleets")}</Label>
                <Select value={fleetId} onValueChange={setFleetId} disabled={submitting}>
                  <SelectTrigger id="partner-fleet"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="independent">{t("auth.independentDriver")}</SelectItem>
                    {(fleets.data ?? []).map((fleet) => <SelectItem key={fleet.id} value={fleet.id}>{fleet.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {fleets.isError && (
                  <Button type="button" size="sm" variant="link" onClick={() => void fleets.refetch()}>{t("common.tryAgain")}</Button>
                )}
              </div>
            )}
            {needsPin && (
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">{t("admin.partnerNeedsPin")}</p>
                <Label htmlFor="partner-pin">{t("auth.pin")}</Label>
                <Input id="partner-pin" type="password" inputMode="numeric" autoComplete="new-password"
                  maxLength={4} required value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
              </div>
            )}
            <Button type="submit" className="min-h-11" disabled={submitting || !name.trim() || !isValidPhone(phone) || (needsPin && !isValidPin(pin))}>
              {submitting ? t("common.saving") : t("admin.addPartner")}
            </Button>
          </fieldset>
        </form>
      </CardContent>
    </Card>
  );
};
