import { useState, useCallback } from "react";
import { useAuth } from "./useAuth";

/**
 * Hook that gates an action behind client authentication.
 * Returns { requireAuth, dialogProps } — call requireAuth(callback)
 * before any action that needs a logged-in client.
 */
export const useRequireClientAuth = () => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const requireAuth = useCallback(
    (action?: () => void) => {
      if (user) {
        action?.();
        return true;
      }
      setPendingAction(() => action ?? null);
      setOpen(true);
      return false;
    },
    [user],
  );

  const onSignupSuccess = useCallback(() => {
    setOpen(false);
    pendingAction?.();
    setPendingAction(null);
  }, [pendingAction]);

  return { isAuthed: !!user, requireAuth, open, setOpen, onSignupSuccess };
};
