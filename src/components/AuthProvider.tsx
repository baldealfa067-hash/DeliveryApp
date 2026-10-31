import type { ReactNode } from "react";
import { AuthContext, useAuthState } from "@/hooks/useAuth";

/**
 * Envolva a app uma única vez (main.tsx).
 *
 * Faz getSession + leitura de papéis UMA vez e partilha user, roles,
 * rolesLoaded, rolesError e loading com todos os componentes — sem ele, cada
 * componente corria o seu próprio ciclo e o arranque disparava 12–20 pedidos
 * repetidos a user_roles. Os componentes continuam a chamar useAuth() com a
 * mesma API; este provider é só a fonte única do estado.
 */
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const state = useAuthState(true);
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
};
