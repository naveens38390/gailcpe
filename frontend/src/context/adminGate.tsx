/**
 * The lock on the Admin Panel.
 *
 * The pricing screens are open — an officer on a stand should not have to sign
 * in to answer a question. Master data is different: everything behind the
 * Admin Panel writes to the published dataset, so it asks for the
 * administrator's credentials before it opens.
 *
 * The check is a real one. It posts to the same /auth/login the API uses, so a
 * wrong password is rejected by the backend rather than by a string comparison
 * on the device. The unlock lasts for the life of the process and is never
 * written to storage: closing the app re-locks the panel.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { api } from "../services/api";

interface AdminGateState {
  unlocked: boolean;
  /** Resolves true when the credentials are accepted. */
  unlock: (email: string, password: string) => Promise<boolean>;
  lock: () => void;
  /** The account name the panel was unlocked with. */
  admin: string | null;
}

const AdminGateContext = createContext<AdminGateState | null>(null);

export function AdminGateProvider({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
  const [admin, setAdmin] = useState<string | null>(null);

  const unlock = useCallback(async (email: string, password: string) => {
    const result = await api.verifyCredentials(email.trim().toLowerCase(), password);
    setAdmin(result.user?.name ?? result.user?.email ?? null);
    setUnlocked(true);
    return true;
  }, []);

  const lock = useCallback(() => {
    setUnlocked(false);
    setAdmin(null);
  }, []);

  const value = useMemo(() => ({ unlocked, unlock, lock, admin }), [unlocked, unlock, lock, admin]);
  return <AdminGateContext.Provider value={value}>{children}</AdminGateContext.Provider>;
}

export function useAdminGate(): AdminGateState {
  const context = useContext(AdminGateContext);
  if (!context) throw new Error("useAdminGate must be used inside AdminGateProvider");
  return context;
}
