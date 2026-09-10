import { useState, useEffect, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Store, User, ArrowLeft, Bike, Truck } from "lucide-react";
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
import { isPasswordBreached } from "@/lib/passwordBreach";
import logo from "@/assets/logo.png";

type ProfileType = "business";
type AuthMode = "choose" | "client" | "professional" | "driver" | "fleet";

const Login = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, isAdmin, isBusiness, isClient, rolesLoaded, loading } = useAuth();
  const [mode, setMode] = useState<AuthMode>(() => {
    const m = searchParams.get("mode");
    if (m === "cliente") return "client";
    if (m === "restaurante") return "professional";
    if (m === "frota") return "fleet";
    // `?mode=motorista` deixou de abrir o registo de motorista. Era a última
    // porta pública para o auto-registo depois de o cartão sair do ecrã de
    // escolha — ver o comentário do cartão, mais abaixo. O modo "driver" em si
    // mantém-se no ficheiro: é o que a frota vai reutilizar na Fase 3/4 para
    // criar os seus motoristas, e é o ecrã que um motorista já registado vê.
    return "choose";
  });
  const [tab, setTab] = useState<"login" | "signup">(
    searchParams.get("tab") === "registar" ? "signup" : "login"
  );
  const [profileType] = useState<ProfileType>("business");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [forgotPinOpen, setForgotPinOpen] = useState(false);
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
    if (!isValidPin(pin)) return toast.error(t("auth.pinFourDigits"));
    setSubmitting(true);
    try {
      const { error } = await entrarComPin(phone, pin);
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
        if (chave === "auth.phoneTaken") setTab("login");
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

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return toast.error(t("auth.passwordMin"));
    if (!name.trim()) return toast.error(t("auth.enterName"));
    if (mode === "fleet" && !phone.trim()) return toast.error("Telefone de contacto obrigatório");
    setSubmitting(true);
    // Antes de criar a conta: esta palavra-passe já apareceu numa fuga pública?
    // Contas de restaurante e motorista veem dados de clientes e de vendas.
    if (await isPasswordBreached(password)) {
      setSubmitting(false);
      return toast.error(t("auth.passwordBreached"));
    }
    signingUp.current = true;
    try {
      const isClientFlow = mode === "client";
      const isDriverFlow = mode === "driver";
      const isFleetFlow = mode === "fleet";
      const redirectPath = isFleetFlow
        ? "/painel-frota"
        : isDriverFlow
          ? "/painel-motorista"
          : isClientFlow
            ? "/inicio"
            : "/painel-loja/editar";

      // Passar profile_type no metadata para o trigger handle_new_user criar a role
      // mesmo quando Confirm Email = ON (session === null)
      const profileTypeForMeta = isClientFlow || isDriverFlow || isFleetFlow ? "client" : profileType;
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
        if (isFleetFlow) {
          const { error: roleErr } = await supabase.rpc("register_as_client");
          if (roleErr) console.error("Role error:", roleErr);
          // create_fleet() e' quem atribui o papel `fleet`. Se falhar, nao se
          // bloqueia a entrada: /painel-frota mostra o formulario de criacao,
          // que chama exactamente a mesma RPC.
          const { error: fleetErr } = await (
            supabase.rpc as unknown as (
              fn: string, args: Record<string, unknown>,
            ) => Promise<{ error: { message: string } | null }>
          )("create_fleet", { p_name: name.trim(), p_phone: phone.trim(), p_bairro: null });
          if (fleetErr) toast.error(fleetErr.message);
        } else if (isClientFlow || isDriverFlow) {
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

          {/* §11: a frota é a única via de registo de operação logística na V1.
              Reutiliza o mesmo fluxo profissional (email + password) do
              restaurante -- não há um fluxo à parte. */}
          <Card
            className="cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
            onClick={() => setMode("fleet")}
          >
            <CardContent className="flex items-center gap-4 p-4">
              <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Truck className="h-6 w-6 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold">Frota</p>
                <p className="text-xs text-muted-foreground">Gerir motoristas, preços e entregas</p>
              </div>
            </CardContent>
          </Card>

          {/* O cartão "Motorista" saiu daqui deliberadamente (Aditamento 1 do
              documento mestre): na V1 só frotas se registam como operadores
              logísticos, e é a frota que cadastra os seus motoristas (§11,
              §12). Não é um esquecimento — o auto-registo chegou a existir,
              foi publicado e está a ser revertido de propósito.

              O que NÃO saiu, e não deve sair: o modo "driver" deste ficheiro,
              o DriverDashboard e as RPC de aceitar/recolher/entregar. Esse
              código continua a ser o fluxo do motorista; muda apenas quem cria
              a conta. A Fase 3 liga-o à frota em vez de o duplicar
              (Aditamento 1.4).

              Um motorista já existente continua a entrar: entra como cliente e
              getPostLoginDestination manda-o para /painel-motorista por ter
              linha em `drivers`. */}

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
  const isFleetFlow = mode === "fleet";

  const campoPin = (id: string, valor: string, setter: (v: string) => void, etiqueta: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{etiqueta}</Label>
      <Input
        id={id}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        pattern="\d*"
        maxLength={PIN_LENGTH}
        placeholder={"\u2022".repeat(PIN_LENGTH)}
        value={valor}
        onChange={(e) => setter(e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH))}
        className="h-12 text-center text-title tracking-[0.5em]"
      />
    </div>
  );

  const campoTelefone = (id: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t("auth.phone")}</Label>
      <Input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder={t("auth.phonePlaceholder")}
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        className="h-12 text-body"
      />
    </div>
  );

  // ─── ECRÃ: Cliente (telefone + PIN) ───
  // Sem email e sem Google: o cliente identifica-se pelo telefone, que é o que
  // ele sabe de cor. O PIN é escolhido por ele, e a credencial derivada dos dois
  // é sempre a mesma — por isso entrar noutro telemóvel é só voltar a escrevê-los.
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
            <img src={logo} alt="Bornaal" className="mx-auto h-10" />
            <h1 className="text-title">{t("auth.clientLoginTitle")}</h1>
            <p className="text-caption text-muted-foreground">{t("auth.clientLoginPinDesc")}</p>
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as "login" | "signup")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">{t("auth.loginTab")}</TabsTrigger>
              <TabsTrigger value="signup">{t("auth.signupTab")}</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={handleClientLogin} className="mt-4 space-y-3">
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
          <img src={logo} alt="Bornaal" className="h-10 mx-auto" />
          <h1 className="text-xl font-bold">
            {isFleetFlow ? "Conta de Frota" : isDriverFlow ? "Conta de Motorista" : isClientFlow ? t("auth.clientLoginTitle") : t("auth.professionalLoginTitle")}
          </h1>
          <p className="text-xs text-muted-foreground">
            {isFleetFlow ? "Registe a frota para gerir motoristas e entregas" : isDriverFlow ? "Cria a tua conta para começar a entregar" : isClientFlow ? t("auth.clientLoginSubtitle") : t("auth.professionalLoginSubtitle")}
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
                <Label htmlFor="name">{isFleetFlow ? "Nome da frota" : t("auth.name")}</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              {isFleetFlow && (
                <div className="space-y-1">
                  <Label htmlFor="fleet-phone">Telefone de contacto</Label>
                  <Input
                    id="fleet-phone"
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="9XXXXXXXX"
                    required
                  />
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="email-s">{t("auth.email")}</Label>
                <Input id="email-s" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="password-s">{t("auth.password")}</Label>
                <Input id="password-s" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
              </div>
              <Button type="submit" disabled={submitting} className="w-full h-11">
                {submitting
                  ? t("auth.creatingAccount")
                  : isFleetFlow
                    ? "Criar conta de frota"
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
