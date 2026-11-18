import { useState } from "react";
import type { FormEvent } from "react";
import { Bike } from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { LanguageSelector } from "@/components/LanguageSelector";
import { LoadError } from "@/components/LoadError";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { contactFromUser } from "@/lib/clientAuth";

const IndependentDriverRegistration = () => {
  const { t } = useTranslation();
  const { user, roles, loading, sessionError, retrySession, rolesError, retryRoles, signOut } = useAuth();
  const queryClient = useQueryClient();
  const [name, setName] = useState<string>();
  const [saving, setSaving] = useState(false);
  const contact = contactFromUser(user);
  const driverName = name ?? contact.name;
  const phone = /^c([1-9][0-9]{6,8})@deliveryapp\.gw$/i.exec(user?.email ?? "")?.[1];

  const register = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || !phone || !driverName.trim() || saving) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc("register_independent_driver", {
        p_name: driverName.trim(),
        p_phone: phone,
      });
      if (error) throw error;
      void queryClient.invalidateQueries({ queryKey: ["driver", user.id] });
      void queryClient.invalidateQueries({ queryKey: ["post-login-destination", user.id] });
      retryRoles();
    } catch {
      toast.error(t("auth.registerError"));
    } finally {
      setSaving(false);
    }
  };

  if (sessionError) return <LoadError onRetry={retrySession} />;
  if (user && rolesError) return <LoadError onRetry={retryRoles} />;
  if (loading) return <p role="status" className="p-6 text-center">{t("common.loading")}</p>;
  if (user && roles.includes("driver")) return <Navigate to="/painel-motorista" replace />;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 px-4 py-8">
      <div className="flex items-center justify-between">
        <Link to={user ? "/inicio" : "/login"} className="text-sm text-muted-foreground">{t("common.back")}</Link>
        <LanguageSelector />
      </div>
      <div className="space-y-2">
        <Bike aria-hidden className="h-7 w-7 text-primary" />
        <h1 className="text-2xl font-bold">{t("auth.independentDriver")}</h1>
        <p className="text-sm text-muted-foreground">{t("auth.independentDriverDesc")}</p>
      </div>
      <Card>
        <CardContent className="space-y-3 p-4">
          {!user && (
            <>
              <Button asChild className="w-full"><Link to="/login?mode=motorista&tab=registar">{t("auth.signupTab")}</Link></Button>
              <Button asChild variant="outline" className="w-full"><Link to="/login?mode=motorista">{t("auth.loginTab")}</Link></Button>
            </>
          )}
          {user && !phone && (
            <>
              <p className="text-sm">{t("auth.independentDriverPhoneRequired")}</p>
              <Button variant="outline" onClick={async () => {
                try {
                  const { error } = await signOut();
                  if (error) throw error;
                } catch {
                  toast.error(t("common.errorLoading"));
                }
              }}>{t("common.logout")}</Button>
            </>
          )}
          {user && phone && (
            <form onSubmit={register} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="driver-name">{t("auth.name")}</Label>
                <Input id="driver-name" value={driverName} maxLength={100} required onChange={(event) => setName(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="driver-phone">{t("auth.phone")}</Label>
                <Input id="driver-phone" type="tel" value={phone} readOnly />
              </div>
              <Button type="submit" className="w-full" disabled={saving || !driverName.trim()}>
                {saving ? t("common.saving") : t("auth.createDriverProfile")}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
};

export default IndependentDriverRegistration;
