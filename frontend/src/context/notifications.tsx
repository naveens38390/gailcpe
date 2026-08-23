/**
 * The unread notification count, polled in the background so the drawer badge
 * stays current without every screen having to ask for it itself.
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { api } from "../services/api";

const POLL_MS = 30_000;

const NotificationsBadgeContext = createContext<{ unreadCount: number } | null>(null);

export function NotificationsBadgeProvider({ children }: { children: ReactNode }) {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const { count } = await api.unreadNotificationCount();
        if (!cancelled) setUnreadCount(count);
      } catch {
        // A failed poll just tries again next tick — the badge is a hint, not
        // a source of truth the rest of the app depends on.
      }
    }
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <NotificationsBadgeContext.Provider value={{ unreadCount }}>
      {children}
    </NotificationsBadgeContext.Provider>
  );
}

export function useNotificationsBadge(): { unreadCount: number } {
  const context = useContext(NotificationsBadgeContext);
  if (!context) throw new Error("useNotificationsBadge must be used inside NotificationsBadgeProvider");
  return context;
}
