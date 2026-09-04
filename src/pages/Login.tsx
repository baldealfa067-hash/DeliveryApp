import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Store, User, ArrowLeft, Bike } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { JUST_SIGNED_UP_KEY } from "@/lib/push";
import { useTranslation } from "react-i18next";
import { LanguageSelector } from "@/components/LanguageSelector";
import { getPostLoginDestination } from "@/lib/getPostLoginDestination";
import logo from "@/assets/logo.png";

type ProfileType = "business";
type AuthMode = "choose" | "client" | "professional" | "driver";

const Login = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, isAdmin, isBusiness, isClient, rolesLoaded, loading } = useAuth();
  const [mode, setMode] = useState<AuthMode>(() => {
    const m = searchParams.get("mode");
    if (m === "cliente") return "client";
    if (m === "motorista") return "driver";
    if (m === "restaurante") return "professional";
    return "choose";
  });
  const [tab, setTab] = useState<"login" | "signup">(
    searchParams.get("tab") === "registar" ? "signup" : "login"
  );
  const [profileType] = useState<ProfileType>("business");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const signingUp = useRef(false);

  useEffect(() => {
    if (signingUp.current) return;
    if (loading || !rolesLoaded) return;
    if (!user) return;

    // Handle Google OAuth callback — assign the role that was selected before redirect
    if (searchParams.get("fromGoogle") === "true") {
      const savedMode = sessionStorage.getItem("bornaal:google_mode");
      const savedType = sessionStorage.getItem("bornaal:google_profile_type");
      sessionStorage.removeItem("bornaal:google_mode");
      sessionStorage.removeItem("bornaal:google_profile_type");

      const assignRoleAndRedirect = async () => {
        signingUp.current = true;
        try {
          if (savedMode === "client") {
            const { error } = await supabase.rpc("register_as_client");
            if (error) console.error("Role error:", error);
            sessionStorage.setItem(JUST_SIGNED_UP_KEY, "1");
            // Depois de registar, usa destino centralizado (driver tem prioridade)
            const dest = await getPostLoginDestination(user.id);
            navigate(dest, { replace: true });
          } else {
            const { error } = await supabase.rpc("register_as_business");
            if (error) console.error("Role error:", error);
            navigate("/painel-loja/editar", { replace: true });
          }
        } finally {
          signingUp.current = false;
        }
      };

      // Se já tem sessão e roles, usa destino centralizado (driver > business > cliente)
      if (isBusiness || isClient || isAdmin) {
        (async () => {
          const dest = await getPostLoginDestination(user.id);
          navigate(dest, { replace: true });
        })();
        return;
      }

      // First-time Google user — assign role
      assignRoleAndRedirect();
      return;
    }

    // Login normal — destino centralizado com prioridade driver > business > beleza > cliente
    (async () => {
      const dest = await getPostLoginDestination(user.id);
      navigate(dest, { replace: true });
    })();
  }, [user, isAdmin, isBusiness, isClient, rolesLoaded, loading, navigate, searchParams]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (error) return toast.error(error.message);
    toast.success(t("auth.loginSuccess"));
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) return toast.error(t("auth.passwordMin"));
    if (!name.trim()) return toast.error(t("auth.enterName"));
    signingUp.current = true;
    setSubmitting(true);
    try {
      const isClientFlow = mode === "client";
      const isDriverFlow = mode === "driver";
      const redirectPath = isDriverFlow ? "/painel-motorista" : isClientFlow ? "/inicio" : "/painel-loja/editar";

      // Passar profile_type no metadata para o trigger handle_new_user criar a role
      // mesmo quando Confirm Email = ON (session === null)
      const profileTypeForMeta = isClientFlow || isDriverFlow ? "client" : profileType;
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}${redirectPath}`,
          data: { name, profile_type: profileTypeForMeta },
        },
      });
      if (error || !data.user) {
        return toast.error(error?.message ?? t("auth.registerError"));
      }
      if (data.session) {
        // Confirm email OFF — session existe, garantir role via RPC também (trigger já fez, mas RPC é idempotente)
        if (isClientFlow || isDriverFlow) {
          const { error: roleErr } = await supabase.rpc("register_as_client");
          if (roleErr) console.error("Role error:", roleErr);
        } else {
          const { error: roleErr } = await supabase.rpc("register_as_business");
          if (roleErr) console.error("Role error:", roleErr);
        }
        toast.success(t("auth.accountCreated"));
        sessionStorage.setItem(JUST_SIGNED_UP_KEY, "1");
        navigate(redirectPath, { replace: true });
      } else {
        // Confirm email ON — sem session, role já criada pelo trigger handle_new_user via metadata
        // Instruir utilizador a confirmar email
        toast.success(t("auth.accountCreated") + " " + t("auth.checkEmailToConfirm", "Verifique o seu email para confirmar a conta."));
      }
    } finally {
      signingUp.current = false;
      setSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    const isDriverFlow = mode === "driver";
    const googleMode = isDriverFlow ? "client" : isClientFlow ? "client" : "professional";
    sessionStorage.setItem("bornaal:google_mode", googleMode);
    if (!isClientFlow && !isDriverFlow) {
      sessionStorage.setItem("bornaal:google_profile_type", profileType);
    }
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/login?fromGoogle=true`,
      },
    });
    setSubmitting(false);
    if (error) toast.error(error.message);
  };

  // ─── TELA: Escolher tipo de conta ───
  if (mode === "choose") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-background">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex items-center justify-between">
            <LanguageSelector />
          </div>

          <div className="text-center space-y-2">
            <img src={logo} alt="Bornaal" className="h-12 mx-auto" />
            <h1 className="text-2xl font-bold">{t("auth.welcomeTitle")}</h1>
            <p className="text-sm text-muted-foreground">{t("auth.welcomeSubtitle")}</p>
          </div>

          <Card
            className="cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
            onClick={() => setMode("client")}
          >
            <CardContent className="flex items-center gap-4 p-4">
              <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <User className="h-6 w-6 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold">{t("auth.clientLabel")}</p>
                <p className="text-xs text-muted-foreground">{t("auth.clientDesc")}</p>
              </div>
            </CardContent>
          </Card>

          <Card
            className="cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
            onClick={() => setMode("professional")}
          >
            <CardContent className="flex items-center gap-4 p-4">
              <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Store className="h-6 w-6 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold">Restaurante</p>
                <p className="text-xs text-muted-foreground">Gerir restaurante e receber pedidos</p>
              </div>
            </CardContent>
          </Card>

          <Card
            className="cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
            onClick={() => setMode("driver")}
          >
            <CardContent className="flex items-center gap-4 p-4">
              <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Bike className="h-6 w-6 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold">Motorista</p>
                <p className="text-xs text-muted-foreground">Entregar pedidos e ganhar dinheiro</p>
              </div>
            </CardContent>
          </Card>

          <p className="text-center text-xs text-muted-foreground">
            {t("auth.alreadyAccount")}{" "}
            <button onClick={() => { setMode("client"); setTab("login"); }} className="text-primary hover:underline font-medium">
              {t("auth.loginTab")}
            </button>
          </p>
        </div>
      </div>
    );
  }

  // ─── TELA: Auth (Cliente / Restaurante / Motorista) ───
  const isClientFlow = mode === "client";
  const isDriverFlow = mode === "driver";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-background">
      <div className="w-full max-w-sm space-y-5">
        <div className="flex items-center justify-between">
          <button onClick={() => setMode("choose")} className="text-muted-foreground hover:text-foreground p-1 -ml-1">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <LanguageSelector />
        </div>

        <div className="text-center space-y-1">
          <img src={logo} alt="Bornaal" className="h-10 mx-auto" />
          <h1 className="text-xl font-bold">
            {isDriverFlow ? "Conta de Motorista" : isClientFlow ? t("auth.clientLoginTitle") : t("auth.professionalLoginTitle")}
          </h1>
          <p className="text-xs text-muted-foreground">
            {isDriverFlow ? "Cria a tua conta para começar a entregar" : isClientFlow ? t("auth.clientLoginSubtitle") : t("auth.professionalLoginSubtitle")}
          </p>
        </div>

        {/* Restaurante é o único perfil profissional no DeliveryApp */}

        {/* Google OAuth (preparado — desativado sem credenciais) */}
        <Button
          variant="outline"
          className="w-full gap-2 h-12 text-sm"
          onClick={handleGoogleLogin}
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          {t("auth.continueWithGoogle")}
        </Button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">{t("auth.or")}</span>
          </div>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "login" | "signup")}>
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="login">{t("auth.loginTab")}</TabsTrigger>
            <TabsTrigger value="signup">{t("auth.signupTab")}</TabsTrigger>
          </TabsList>

          <TabsContent value="login">
            <form onSubmit={handleLogin} className="flex flex-col gap-3 mt-4">
              <div className="space-y-1">
                <Label htmlFor="email">{t("auth.email")}</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="password">{t("auth.password")}</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              <div className="text-right">
                <button type="button" onClick={() => navigate("/esqueci-senha")} className="text-xs text-primary hover:underline">
                  {t("auth.forgotPassword")}
                </button>
              </div>
              <Button type="submit" disabled={submitting} className="w-full h-11">
                {submitting ? t("auth.loggingIn") : t("auth.loginButton")}
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="signup">
            <form onSubmit={handleSignup} className="flex flex-col gap-3 mt-4">
              <div className="space-y-1">
                <Label htmlFor="name">{t("auth.name")}</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="email-s">{t("auth.email")}</Label>
                <Input id="email-s" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="password-s">{t("auth.password")}</Label>
                <Input id="password-s" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
              </div>
              <Button type="submit" disabled={submitting} className="w-full h-11">
                {submitting
                  ? t("auth.creatingAccount")
                  : isDriverFlow
                    ? "Criar conta de motorista"
                    : isClientFlow
                      ? t("auth.createClientAccount")
                      : t("auth.createBusinessAccount")}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                {isDriverFlow ? "Depois irás para o registo de motorista." : isClientFlow ? t("auth.afterClient") : t("auth.afterBusiness")}
              </p>
            </form>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Login;
