import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, UserPlus, LogIn } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "react-i18next";
import {
  PIN_LENGTH,
  clientAuthErrorKey,
  clientEmail,
  derivePassword,
  isValidPhone,
  isValidPin,
  normalizePhone,
} from "@/lib/clientAuth";

interface ClientSignupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

/** Campo de PIN: teclado numérico em telemóvel e nunca mais de 4 dígitos. */
const PinInput = ({
  id,
  value,
  onChange,
  label,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  label: string;
}) => (
  <div className="space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    <Input
      id={id}
      type="password"
      inputMode="numeric"
      autoComplete="off"
      pattern="\d*"
      maxLength={PIN_LENGTH}
      placeholder={"•".repeat(PIN_LENGTH)}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH))}
      className="h-12 text-center text-title tracking-[0.5em]"
    />
  </div>
);

/**
 * Porta de entrada do cliente, mostrada quando é preciso conta para prosseguir.
 * Tem as duas metades: criar conta e entrar. Sem a segunda, quem já tivesse
 * conta e voltasse noutro telemóvel só via o registo e batia em "telefone já
 * registado", sem saída.
 */
export const ClientSignupDialog = ({ open, onOpenChange, onSuccess }: ClientSignupDialogProps) => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"signup" | "login">("signup");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const entrar = async (rawPhone: string, rawPin: string) => {
    const password = await derivePassword(rawPhone, rawPin);
    return supabase.auth.signInWithPassword({ email: clientEmail(rawPhone), password });
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error(t("auth.enterName"));
    if (!isValidPhone(phone)) return toast.error(t("auth.enterValidPhone"));
    if (!isValidPin(pin)) return toast.error(t("auth.pinFourDigits"));
    if (pin !== pinConfirm) return toast.error(t("auth.pinMismatch"));

    setSubmitting(true);
    try {
      const password = await derivePassword(phone, pin);
      const { data, error } = await supabase.auth.signUp({
        email: clientEmail(phone),
        password,
        // profile_type e' obrigatorio: sem ele o trigger handle_new_user usava o
        // valor por defeito e a conta ficava com papel de restaurante.
        options: { data: { name: name.trim(), phone: normalizePhone(phone), profile_type: "client" } },
      });

      if (error || !data.user) {
        const chave = clientAuthErrorKey(error?.message, "signup");
        if (chave === "auth.phoneTaken") setTab("login");
        return toast.error(t(chave));
      }

      // Sem sessão imediata (Confirm Email ligado no Supabase) o registo não
      // serve de nada com um email sintético, que ninguém pode confirmar.
      // Tentamos entrar de imediato para o problema aparecer aqui e não depois.
      if (!data.session) {
        const { error: loginErr } = await entrar(phone, pin);
        if (loginErr) return toast.error(t(clientAuthErrorKey(loginErr.message, "login")));
      }

      const { error: roleErr } = await supabase.rpc("register_as_client");
      if (roleErr) console.error("[auth] register_as_client:", roleErr.message);

      toast.success(t("auth.accountCreated"));
      limpar();
      onSuccess();
    } catch (err) {
      console.error("[auth] signup:", err);
      toast.error(t("auth.registerError"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidPhone(phone)) return toast.error(t("auth.enterValidPhone"));
    if (!isValidPin(pin)) return toast.error(t("auth.pinFourDigits"));

    setSubmitting(true);
    try {
      const { error } = await entrar(phone, pin);
      if (error) return toast.error(t(clientAuthErrorKey(error.message, "login")));
      toast.success(t("auth.loginSuccess"));
      limpar();
      onSuccess();
    } catch (err) {
      console.error("[auth] login:", err);
      toast.error(t("auth.loginError"));
    } finally {
      setSubmitting(false);
    }
  };

  const limpar = () => {
    setName("");
    setPhone("");
    setPin("");
    setPinConfirm("");
  };

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-sm [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {tab === "signup" ? <UserPlus className="h-5 w-5 text-primary" /> : <LogIn className="h-5 w-5 text-primary" />}
            {tab === "signup" ? t("auth.clientSignupTitle") : t("auth.clientLoginTitle")}
          </DialogTitle>
          <DialogDescription>
            {tab === "signup" ? t("auth.clientSignupDesc") : t("auth.clientLoginPinDesc")}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "signup" | "login")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="signup">{t("auth.signupTab")}</TabsTrigger>
            <TabsTrigger value="login">{t("auth.loginTab")}</TabsTrigger>
          </TabsList>

          <TabsContent value="signup">
            <form onSubmit={handleSignup} className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="signup-name">{t("auth.name")}</Label>
                <Input
                  id="signup-name"
                  placeholder={t("auth.namePlaceholder")}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-12 text-body"
                />
              </div>
              {campoTelefone("signup-phone")}
              <PinInput id="signup-pin" value={pin} onChange={setPin} label={t("auth.choosePin")} />
              <PinInput id="signup-pin-2" value={pinConfirm} onChange={setPinConfirm} label={t("auth.confirmPin")} />
              <p className="text-caption text-muted-foreground">{t("auth.pinHint")}</p>
              <Button type="submit" disabled={submitting} className="h-12 w-full gap-2 text-body font-semibold">
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("auth.createClientAccount")}
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="login">
            <form onSubmit={handleLogin} className="mt-4 space-y-3">
              {campoTelefone("login-phone")}
              <PinInput id="login-pin" value={pin} onChange={setPin} label={t("auth.pin")} />
              <Button type="submit" disabled={submitting} className="h-12 w-full gap-2 text-body font-semibold">
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("auth.loginButton")}
              </Button>
              <p className="text-center text-caption text-muted-foreground">{t("auth.forgotPinHint")}</p>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
