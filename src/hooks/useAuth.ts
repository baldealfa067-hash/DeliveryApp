import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "provider" | "client" | "business" | "beleza" | "driver" | "fleet";

type AuthState = {
  session: Session | null;
  user: User | null;
  roles: AppRole[];
  isAdmin: boolean;
  isProvider: boolean;
  isBusiness: boolean;
  isBeleza: boolean;
  isClient: boolean;
  rolesLoaded: boolean;
  rolesError: string | null;
  sessionError: boolean;
  retrySession: () => void;
  loading: boolean;
  retryRoles: () => void;
  signOut: () => ReturnType<typeof supabase.auth.signOut>;
};

export const AuthContext = createContext<AuthState | null>(null);

/** Tentativas de leitura de user_roles antes de desistir: 500ms, 1s, 2s. */
const ROLES_RETRY_DELAYS_MS = [500, 1000, 2000];

/**
 * Estado de autenticação da app, com uma só leitura de papéis partilhada.
 *
 * Antes, cada componente corria o seu próprio getSession + query a user_roles
 * — mediam-se 12–20 pedidos repetidos a user_roles por carregamento de página.
 * O AuthProvider corre isto uma vez; os componentes leem do contexto.
 * `enabled` liga os efeitos: true no provider, e também no fallback local
 * para componentes renderizados fora do provider (testes unitários).
 *
 * REGRA CENTRAL: um ERRO de leitura de user_roles NÃO é "sem papéis".
 * O erro era engolido (`data ?? []`), o que mandava admin e clientes para
 * /perfil com "Ainda não criaste o teu perfil de prestador". Agora:
 *   - query falha → tenta outra vez com backoff (500ms/1s/2s); se ainda
 *     falhar, rolesError fica preenchido e rolesLoaded continua false;
 *   - roles=[] só quando a query teve SUCESSO e devolveu zero linhas.
 */
export const useAuthState = (enabled: boolean): AuthState => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [rolesLoaded, setRolesLoaded] = useState(false);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState(false);
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const retrySession = useCallback(() => {
    setSessionError(false);
    setSessionAttempt((attempt) => attempt + 1);
  }, []);
  const [rolesAttempt, setRolesAttempt] = useState(0);
  // Utilizador a quem pertencem rolesLoaded/rolesError. Sem esta marca há uma
  // janela de render em que a sessão já chegou (user definido) mas os papéis
  // ainda dizem "carregados" do estado de visitante (roles=[]) — e os guards
  // decidem nessa janela, mandando admins para /inicio e motoristas para
  // /perfil antes de a query a user_roles terminar.
  const rolesUidRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let receivedSessionEvent = false;
    const aplicarSessao = (s: Session | null) => {
      setSession(s);
      setUser(s?.user ?? null);
      const uid = s?.user?.id ?? null;
      if (uid !== rolesUidRef.current) {
        rolesUidRef.current = uid;
        // Mesmo batch do setUser: o render seguinte já vê papéis por confirmar.
        setRolesLoaded(false);
        setRolesError(null);
      }
    };
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      // INITIAL_SESSION omits the error. Use getSession to classify that result.
      if (!active || event === "INITIAL_SESSION") return;
      receivedSessionEvent = true;
      aplicarSessao(s);
      setSessionError(false);
      setSessionReady(true);
    });

    supabase.auth.getSession().then(({ data: { session: s }, error }) => {
      if (!active || receivedSessionEvent) return;
      if (error && (error.status == null || error.status === 0 || error.status === 429 || error.status >= 500)) {
        setSessionError(true);
        return;
      }
      aplicarSessao(s);
      setSessionReady(true);
    }).catch(() => {
      if (active && !receivedSessionEvent) setSessionError(true);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [enabled, sessionAttempt]);

  const userId = user?.id ?? null;

  useEffect(() => {
    if (!enabled) return;
    if (!userId) {
      // Sem sessão não há papéis a ler: vazio é um facto, não uma falha.
      setRoles([]);
      setRolesError(null);
      setRolesLoaded(true);
      return;
    }
    let cancelled = false;
    setRolesLoaded(false);
    setRolesError(null);
    (async () => {
      for (let attempt = 0; attempt <= ROLES_RETRY_DELAYS_MS.length; attempt++) {
        const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
        if (cancelled) return;
        if (!error) {
          setRoles(((data ?? []) as { role: AppRole }[]).map((r) => r.role));
          setRolesLoaded(true);
          setRolesError(null);
          return;
        }
        if (attempt < ROLES_RETRY_DELAYS_MS.length) {
          await new Promise((resolve) => setTimeout(resolve, ROLES_RETRY_DELAYS_MS[attempt]));
        }
      }
      // Todas as tentativas falharam: papéis por confirmar, nunca "sem papéis".
      if (!cancelled) setRolesError("roles");
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, userId, rolesAttempt]);

  const retryRoles = useCallback(() => setRolesAttempt((a) => a + 1), []);

  const signOut = useCallback(() => supabase.auth.signOut(), []);

  // `loading` mantém a semântica do hook antigo: só cai a false quando a
  // sessão E os papéis estão resolvidos (sucesso ou erro). AdminDashboard,
  // BusinessDashboard e RequireAdmin decidem com isAdmin/isBusiness no
  // momento em que loading passa a false — se caísse antes de os papéis
  // estarem confirmados, mandavam admins para /login e lojistas para
  // /inicio no arranque da página.
  const loading = !sessionReady || (!!user && !rolesLoaded && !rolesError);

  return {
    session,
    user,
    roles,
    isAdmin: roles.includes("admin"),
    isProvider: roles.includes("provider"),
    isBusiness: roles.includes("business"),
    isBeleza: roles.includes("beleza"),
    isClient: roles.includes("client"),
    rolesLoaded,
    rolesError,
    sessionError,
    retrySession,
    loading,
    retryRoles,
    signOut,
  };
};

/**
 * API inalterada para os componentes: { session, user, roles, isAdmin,
 * isProvider, isBusiness, isBeleza, isClient, rolesLoaded, loading, signOut }
 * mais os novos rolesError e retryRoles. Fora do AuthProvider (testes), cada
 * chamada mantém o estado local antigo — sem rede quando o provider existe.
 */
export const useAuth = (): AuthState => {
  const ctx = useContext(AuthContext);
  const local = useAuthState(ctx === null);
  return ctx ?? local;
};
