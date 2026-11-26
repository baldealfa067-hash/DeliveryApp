import { PhoneInput } from "@/components/PhoneInput";
import { isValidPhone, normalizePhone } from "@/lib/clientAuth";
import { isRestaurantStaffPin, RESTAURANT_STAFF_PIN_LENGTH, restaurantStaffPhone } from "@/lib/restaurantStaffAuth";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

const permissions = ["orders", "finance", "commission"] as const;

export function RestaurantTeam({ businessId }: { businessId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const queryKey = ["restaurant-team", businessId];
  const team = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_restaurant_team", { p_business_id: businessId });
      if (error) throw error;
      return data;
    },
  });
  const save = useMutation({
    mutationFn: async ({ email, access }: { email?: string; access: string[] }) => {
      if (!email) {
        const { error } = await supabase.functions.invoke("restaurant-create-staff", {
          body: { businessId, phone: normalizePhone(phone), pin, permissions: access },
        });
        if (error) {
          const response = error.context instanceof Response ? await error.context.json().catch(() => null) : null;
          throw new Error(t(response?.error === "phone_taken" ? "restaurantTeam.phoneTaken" : "restaurantTeam.createError"));
        }
        return;
      }
      const { error } = await supabase.rpc("set_restaurant_team_access", {
        p_business_id: businessId, p_email: email.trim(), p_permissions: access,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey });
      setEditingEmail(null);
      setPhone("");
      setPin("");
      setSelected([]);
      toast.success(t("restaurantTeam.saved"));
    },
    onError: (error) => toast.error(error.message || t("common.error")),
  });

  return (
    <Card><CardContent className="space-y-4 p-4">
      <h2 className="font-semibold">{t("restaurantTeam.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("restaurantTeam.hint")}</p>
      <Link className="text-sm underline" to="/login?mode=equipa">{t("restaurantTeam.login")}</Link>
      <form className="space-y-3" onSubmit={(event) => {
        event.preventDefault();
        if (!selected.length || save.isPending) return;
        if (!editingEmail && (!isValidPhone(phone) || !isRestaurantStaffPin(pin))) return;
        save.mutate({ email: editingEmail ?? undefined, access: selected });
      }}>
        {editingEmail ? (
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>{restaurantStaffPhone(editingEmail) ?? editingEmail}</span>
            <Button variant="ghost" type="button" onClick={() => { setEditingEmail(null); setSelected([]); }}>{t("common.cancel")}</Button>
          </div>
        ) : (
          <>
            <PhoneInput required value={phone} onChange={(event) => setPhone(event.target.value)} aria-label={t("auth.phone")} placeholder={t("auth.phonePlaceholder")} />
            <Input required type="password" inputMode="numeric" autoComplete="new-password" maxLength={RESTAURANT_STAFF_PIN_LENGTH}
              aria-label={t("restaurantTeam.pinSixDigits")} placeholder={t("restaurantTeam.pinSixDigits")}
              value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, RESTAURANT_STAFF_PIN_LENGTH))} />
          </>
        )}
        <div className="flex flex-wrap gap-3">
          {permissions.map((permission) => (
            <label key={permission} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={selected.includes(permission)}
                onChange={(event) => setSelected((current) => event.target.checked
                  ? [...current, permission] : current.filter((value) => value !== permission))} />
              {t(`restaurantTeam.${permission}`)}
            </label>
          ))}
        </div>
        <Button disabled={!selected.length || save.isPending || (!editingEmail && (!isValidPhone(phone) || !isRestaurantStaffPin(pin)))}>
          {t(editingEmail ? "restaurantTeam.save" : "restaurantTeam.create")}
        </Button>
      </form>
      {team.isError && <Button variant="outline" onClick={() => void team.refetch()}>{t("common.tryAgain")}</Button>}
      {team.data?.map((member) => (
        <div key={member.user_id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <div className="min-w-0 break-all">
            <p className="text-sm font-medium">{restaurantStaffPhone(member.email) ?? member.email}</p>
            <p className="text-xs text-muted-foreground">{member.permissions.length ? member.permissions.map((permission) => t(`restaurantTeam.${permission}`)).join(" · ") : t("restaurantTeam.inactive")}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => {
              setEditingEmail(member.email);
              setSelected(member.permissions);
            }}>{t("restaurantTeam.edit")}</Button>
            {!!member.permissions.length && <Button variant="ghost" size="sm" disabled={save.isPending}
              onClick={() => save.mutate({ email: member.email, access: [] })}>{t("restaurantTeam.remove")}</Button>}
          </div>
        </div>
      ))}
    </CardContent></Card>
  );
}
