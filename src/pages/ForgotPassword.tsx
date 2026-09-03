import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { LanguageSelector } from "@/components/LanguageSelector";
import logo from "@/assets/logo.png";

const ForgotPassword = () => {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    });
    setSubmitting(false);
    if (error) return toast.error(error.message);
    setSent(true);
  };

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
          <CardTitle className="text-xl">{t("forgotPassword.title")}</CardTitle>
          <p className="text-xs text-muted-foreground">
            {t("forgotPassword.subtitle")}
          </p>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="text-center space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("forgotPassword.success")}
              </p>
              <Link to="/login">
                <Button variant="outline" className="w-full">{t("forgotPassword.backToLogin")}</Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <div className="space-y-1">
                <Label htmlFor="email">{t("forgotPassword.email")}</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder={t("forgotPassword.emailPlaceholder")}
                />
              </div>
              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? t("forgotPassword.sending") : t("forgotPassword.sendLink")}
              </Button>
              <Link to="/login" className="text-sm text-center text-muted-foreground hover:text-foreground transition-colors">
                {t("forgotPassword.backToLogin")}
              </Link>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ForgotPassword;
