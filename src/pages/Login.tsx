import { isRestaurantStaffPin, RESTAURANT_STAFF_PIN_LENGTH, restaurantStaffCredentials } from "@/lib/restaurantStaffAuth";
import { LoadError } from "@/components/LoadError";
import { useState, useEffect, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/PhoneInput";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { User, Mail, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { JUST_SIGNED_UP_KEY } from "@/lib/push";
import {
  PIN_LENGTH,
  clientAuthErrorKey,
  clientEmail,
  derivePassword,
  isValidPhone,
  isValidPin,
  normalizePhone,
} from "@/lib/clientAuth";
import { useTranslation } from "react-i18next";
import { LanguageSelector } from "@/components/LanguageSelector";
import { getPostLoginDestination } from "@/lib/getPostLoginDestination";
import logo from "@/assets/itudoo-logo-preto.png";

type AuthMode = "choose" | "client" | "professional";

const Login = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, roles, rolesLoaded, rolesError, retryRoles, loading, sessionError, retrySession } = useAuth();
  const staffLogin = searchParams.get("mode") === "equipa";
  const [mode, setMode] = useState<AuthMode>(() => {
    const m = searchParams.get("mode");
    if (m === "cliente" || m === "motorista" || m === "equipa") return "client";
    if (m === "restaurante" || m === "profissional" || m === "email") return "professional";
    return "choose";
  });
  const [tab, setTab] = useState<"login" | "signup">(
    !staffLogin && searchParams.get("mode") !== "motorista" && searchParams.get("tab") === "registar" ? "signup" : "login"
  );
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [forgotPinOpen, setForgotPinOpen] = useState(false);
  // Mesmo defeito que ClientSignupDialog tinha: ver o comentario la'.
  const [telefoneJaTemConta, setTelefoneJaTemConta] = useState(false);
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const signingUp = useRef(false);
  const [destinationError, setDestinationError] = useState(false);
  const [destinationAttempt, setDestinationAttempt] = useState(0);

  useEffect(() => {
    if (signingUp.current) return;
    if (loading || !rolesLoaded) return;
    if (!user) return;

    if (staffLogin || searchParams.get("next") === "restaurant") {
      navigate("/painel-loja", { replace: true });
      return;
    }

    let active = true;
    void getPostLoginDestination(user.id, roles).then((destination) => {
      if (active) navigate(destination, { replace: true });
    }).catch(() => {
      if (active) setDestinationError(true);
    });
    return () => { active = false; };
  }, [user, roles, rolesLoaded, loading, navigate, searchParams, destinationAttempt, mode, staffLogin]);

  // ── Cliente: telefone + PIN ──────────────────────────────────────────────
  // A password vai derivada do telefone e do PIN, portanto o mesmo par
  // reproduz sempre a mesma credencial e a conta sobrevive a trocar de
  // telemóvel ou a limpar os dados do browser.
  const entrarComPin = async (rawPhone: string, rawPin: string) => {
    const password = await derivePassword(rawPhone, rawPin);
    return supabase.auth.signInWithPassword({ email: clientEmail(rawPhone), password });
  };

  const handleClientLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidPhone(phone)) return toast.error(t("auth.enterValidPhone"));
    if (staffLogin ? !isRestaurantStaffPin(pin) : !isValidPin(pin)) {
      return toast.error(t(staffLogin ? "restaurantTeam.pinSixDigits" : "auth.pinFourDigits"));
    }
    setSubmitting(true);
    try {
      const { error } = staffLogin
        ? await supabase.auth.signInWithPassword(restaurantStaffCredentials(phone, pin))
        : await entrarComPin(phone, pin);
      if (error) return toast.error(t(clientAuthErrorKey(error.message, "login")));
      toast.success(t("auth.loginSuccess"));
    } catch (err) {
      console.error("[auth] client login:", err);
      toast.error(t("auth.loginError"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleClientSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error(t("auth.enterName"));
    if (!isValidPhone(phone)) return toast.error(t("auth.enterValidPhone"));
    if (!isValidPin(pin)) return toast.error(t("auth.pinFourDigits"));
    if (pin !== pinConfirm) return toast.error(t("auth.pinMismatch"));
    signingUp.current = true;
    setSubmitting(true);
    try {
      const password = await derivePassword(phone, pin);
      const { data, error } = await supabase.auth.signUp({
        email: clientEmail(phone),
        password,
        options: { data: { name: name.trim(), phone: normalizePhone(phone), profile_type: "client" } },
      });
      if (error || !data.user) {
        const chave = clientAuthErrorKey(error?.message, "signup");
        if (chave === "auth.phoneTaken") {
          // O PIN inventado agora nao e' o da conta que ja' existe.
          setPin("");
          setPinConfirm("");
          setTelefoneJaTemConta(true);
          setTab("login");
        }
        return toast.error(t(chave));
      }
      if (!data.session) {
        const { error: loginErr } = await entrarComPin(phone, pin);
        if (loginErr) return toast.error(t(clientAuthErrorKey(loginErr.message, "login")));
      }
      const { error: roleErr } = await supabase.rpc("register_as_client");
      if (roleErr) console.error("[auth] register_as_client:", roleErr.message);
      toast.success(t("auth.accountCreated"));
      sessionStorage.setItem(JUST_SIGNED_UP_KEY, "1");
      navigate("/inicio", { replace: true });
    } catch (err) {
      console.error("[auth] client signup:", err);
      toast.error(t("auth.registerError"));
    } finally {
      signingUp.current = false;
      setSubmitting(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (error) return toast.error(error.message);
    toast.success(t("auth.loginSuccess"));
  };

  const handleGoogleLogin = async () => {
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/login?mode=email${searchParams.get("next") === "restaurant" ? "&next=restaurant" : ""}`,
      },
    });
    setSubmitting(false);
    if (error) toast.error(error.message);
  };

  if (sessionError) return <LoadError onRetry={retrySession} />;

  if (user && rolesError) return <LoadError onRetry={retryRoles} />;
  if (user && destinationError) {
    return <LoadError onRetry={() => {
      setDestinationError(false);
      setDestinationAttempt((attempt) => attempt + 1);
    }} />;
  }

  if (loading || (user && !signingUp.current)) {
    return <div role="status" className="flex min-h-screen items-center justify-center text-muted-foreground">{t("common.loading")}</div>;
  }

  // ─── TELA: Escolher tipo de conta ───
  if (mode === "choose") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-background">
        <div className="w-full max-w-sm space-y-6">
          {/* Sem esta saída o ecrã era um beco: quem chegava aqui a partir de
              uma aba protegida (Perfil, Pedidos) ficava sem forma de voltar a
              navegar — e num telemóvel instalado como PWA nem há botão de
              retroceder do browser. Leva a /inicio, não a -1, porque a rota de
              origem volta a redirecionar para cá. */}
          <div className="flex items-center justify-between">
            <Link
              to="/inicio"
              className="-ml-1 inline-flex items-center gap-1 p-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-5 w-5" /> {t("common.back")}
            </Link>
            <LanguageSelector />
          </div>

          <div className="text-center space-y-2">
            <img src={logo} alt="iTudoo" className="h-12 mx-auto" />
            <h1 className="text-2xl font-bold">{t("auth.welcomeTitle")}</h1>
            <p className="text-sm text-muted-foreground">{t("auth.welcomeSubtitle")}</p>
          </div>

          <button type="button" onClick={() => setMode("client")}
            className="flex w-full items-center gap-4 rounded-xl border bg-card p-4 text-left hover:border-primary/50">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <User className="h-6 w-6 text-primary" />
            </span>
            <span>
              <span className="block font-semibold">{t("auth.phoneSignIn")}</span>
              <span className="block text-xs text-muted-foreground">{t("auth.phoneSignInDesc")}</span>
            </span>
          </button>

          <button type="button" onClick={() => setMode("professional")}
            className="flex w-full items-center gap-4 rounded-xl border bg-card p-4 text-left hover:border-primary/50">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <Mail className="h-6 w-6 text-primary" />
            </span>
            <span className="font-semibold">{t("auth.emailSignIn")}</span>
          </button>

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

  // ─── ECRÃ: Autenticação ───
  const isClientFlow = mode === "client";

  const loginPinLength = staffLogin ? RESTAURANT_STAFF_PIN_LENGTH : PIN_LENGTH;
  const campoPin = (id: string, valor: string, setter: (v: string) => void, etiqueta: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{etiqueta}</Label>
      <Input
        id={id}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        pattern="\d*"
        maxLength={loginPinLength}
        placeholder={"\u2022".repeat(loginPinLength)}
        value={valor}
        onChange={(e) => setter(e.target.value.replace(/\D/g, "").slice(0, loginPinLength))}
        className="h-12 text-center text-title tracking-[0.5em]"
      />
    </div>
  );

  const campoTelefone = (id: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t("auth.phone")}</Label>
      <PhoneInput
        id={id}
        placeholder={t("auth.phonePlaceholder")}
        value={phone}
        onChange={(e) => {
          setPhone(e.target.value);
          setTelefoneJaTemConta(false);
        }}
        className="h-12 text-body"
      />
    </div>
  );

  // ─── ECRÃ: Cliente (telefone + PIN) ───
  // Sem email e sem Google: o cliente identifica-se pelo telefone, que é o que
  // ele sabe de cor. O PIN é escolhido por ele, e a credencial derivada dos dois
  // é sempre a mesma — por isso entrar noutro telemóvel é só voltar a escrevê-los.
  if (staffLogin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <form className="w-full max-w-sm space-y-4" onSubmit={handleClientLogin}>
          <LanguageSelector />
          <img src={logo} alt="iTudoo" className="mx-auto h-10" />
          <h1 className="text-center text-title">{t("restaurantTeam.login")}</h1>
          {campoTelefone("staff-login-phone")}
          {campoPin("staff-login-pin", pin, setPin, t("auth.pin"))}
          <Button type="submit" disabled={submitting} className="h-12 w-full">
            {submitting ? t("auth.loggingIn") : t("auth.loginButton")}
          </Button>
        </form>
      </div>
    );
  }

  if (isClientFlow) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm space-y-5">
          <div className="flex items-center justify-between">
            <button onClick={() => setMode("choose")} className="-ml-1 p-1 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <LanguageSelector />
          </div>

          <div className="space-y-1 text-center">
            <img src={logo} alt="iTudoo" className="mx-auto h-10" />
            <h1 className="text-title">{t(tab === "signup" ? "auth.clientSignupTitle" : "auth.phoneSignIn")}</h1>
            <p className="text-caption text-muted-foreground">{t("auth.clientLoginPinDesc")}</p>
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as "login" | "signup")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">{t("auth.loginTab")}</TabsTrigger>
              <TabsTrigger value="signup">{t("auth.signupTab")}</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={handleClientLogin} className="mt-4 space-y-3">
                {telefoneJaTemConta && (
                  <p
                    role="status"
                    className="rounded-md border border-primary/30 bg-primary/5 p-3 text-caption"
                  >
                    {t("auth.phoneTakenNotice")}
                  </p>
                )}
                {campoTelefone("cli-login-phone")}
                {campoPin("cli-login-pin", pin, setPin, t("auth.pin"))}
                <Button type="submit" disabled={submitting} className="h-12 w-full text-body font-semibold">
                  {submitting ? t("auth.loggingIn") : t("auth.loginButton")}
                </Button>
                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => setForgotPinOpen(true)}
                    className="text-caption text-primary underline underline-offset-2"
                  >
                    {t("auth.forgotPin")}
                  </button>
                </div>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleClientSignup} className="mt-4 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cli-name">{t("auth.name")}</Label>
                  <Input
                    id="cli-name"
                    placeholder={t("auth.namePlaceholder")}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="h-12 text-body"
                  />
                </div>
                {campoTelefone("cli-signup-phone")}
                {campoPin("cli-signup-pin", pin, setPin, t("auth.choosePin"))}
                {campoPin("cli-signup-pin-2", pinConfirm, setPinConfirm, t("auth.confirmPin"))}
                <p className="text-caption text-muted-foreground">{t("auth.pinHint")}</p>
                <Button type="submit" disabled={submitting} className="h-12 w-full text-body font-semibold">
                  {submitting ? t("auth.creatingAccount") : t("auth.createClientAccount")}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </div>

        <Dialog open={forgotPinOpen} onOpenChange={setForgotPinOpen}>
          <DialogContent className="w-[calc(100vw-2rem)] max-w-sm">
            <DialogHeader>
              <DialogTitle>{t("auth.forgotPin")}</DialogTitle>
              <DialogDescription>{t("auth.forgotPinDesc")}</DialogDescription>
            </DialogHeader>
            <Button onClick={() => setForgotPinOpen(false)} className="h-12 w-full text-body">
              {t("common.close")}
            </Button>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

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
          <img src={logo} alt="iTudoo" className="h-10 mx-auto" />
          <h1 className="text-xl font-bold">
            {t("auth.emailSignIn")}
          </h1>
          <p className="text-xs text-muted-foreground">
            {t("auth.existingAccountOnly")}
          </p>
        </div>

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
      </div>
    </div>
  );
};

export default Login;
