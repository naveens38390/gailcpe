/**
 * Session state, shared across the app.
 *
 * There is no sign-in screen and no credential prompt. The app holds one
 * administrator account (see lib/api.ts) and authenticates with it silently on
 * launch, so an officer opening the app is already inside it.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { ensureSession, type AuthUser } from "../services/api";

interface AuthState {
  /** The administrator, once the silent sign-in has landed. */
  user: AuthUser | null;
  loading: boolean;
  /** Set only when the API could not be reached at all. */
  error: string | null;
  retry: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    ensureSession()
      .then((signedIn) => {
        if (!cancelled) setUser(signedIn);
      })
      .catch((e) => {
        // Nothing the user can fix with a password — it is the backend being
        // unreachable or refusing the built-in account.
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not reach the pricing service.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const value = useMemo(
    () => ({ user, loading, error, retry }),
    [user, loading, error, retry],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
