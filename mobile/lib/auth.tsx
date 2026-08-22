/**
 * Session state, shared across the app.
 *
 * The token is read from secure storage once on launch so an officer who opened
 * the app yesterday is not asked to sign in again at a customer's desk.
 */

import { router } from "expo-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { api, tokenStore, type AuthUser } from "./api";

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const token = await tokenStore.get();
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        setUser(await api.me());
      } catch {
        // An expired or rejected token is not an error worth showing — it just
        // means signing in again.
        await tokenStore.clear();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { accessToken, user: signedIn } = await api.login(email, password);
    await tokenStore.set(accessToken);
    setUser(signedIn);
    router.replace("/(tabs)");
  }, []);

  const signOut = useCallback(async () => {
    await tokenStore.clear();
    setUser(null);
    router.replace("/login");
  }, []);

  const value = useMemo(
    () => ({ user, loading, signIn, signOut }),
    [user, loading, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

export const ROLE_LABEL: Record<string, string> = {
  sales_officer: "Sales Officer",
  territory_manager: "Territory Manager",
  regional_manager: "Regional Manager",
  corporate_pricing: "Corporate Pricing",
  admin: "Administrator",
};
