import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { LanguageSelector } from "@/components/LanguageSelector";
import logo from "@/assets/logo.png";

const ResetPassword = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { data: { listener } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setReady(true);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });

    return () => listener.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) return toast.error(t("resetPassword.passwordMin"));
    if (password !== confirmPassword) return toast.error(t("resetPassword.passwordMismatch"));
    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (updateError) {
      setError(updateError.message);
      return toast.error(updateError.message);
    }
    toast.success(t("resetPassword.success"));
    navigate("/login", { replace: true });
  };

  if (!ready && !error) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
        <div className="absolute top-4 right-4">
          <LanguageSelector />
        </div>
        <Link to="/" className="mb-6 inline-block">
          <img src={logo} alt="Bornaal" className="h-14 md:h-16 w-auto" />
        </Link>
        <Card className="w-full max-w-sm">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground text-center">{t("resetPassword.validating")}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="absolute top-4 right-4">
        <LanguageSelector />
      </div>
      <Link to="/" className="mb-6 inline-block">
        <img src={logo} alt="Bornaal" className="h-14 md:h-16 w-auto" />
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{t("resetPassword.title")}</CardTitle>
          <p className="text-xs text-muted-foreground">{t("resetPassword.subtitle")}</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="space-y-1">
              <Label htmlFor="password">{t("resetPassword.newPassword")}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                placeholder={t("resetPassword.minChars")}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="confirm">{t("resetPassword.confirmPassword")}</Label>
              <Input
                id="confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                placeholder={t("resetPassword.repeatPassword")}
              />
            </div>
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? t("resetPassword.resetting") : t("resetPassword.resetButton")}
            </Button>
            <Link to="/login" className="text-sm text-center text-muted-foreground hover:text-foreground transition-colors">
              {t("resetPassword.backToLogin")}
            </Link>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default ResetPassword;
