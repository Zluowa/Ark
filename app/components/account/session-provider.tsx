"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type SessionUser = {
  createdAt: number;
  displayName: string;
  email: string;
  id: string;
};

type SessionWorkspace = {
  createdAt: number;
  id: string;
  isActive: boolean;
  name: string;
  role: "owner" | "member";
  slug: string;
  tenantId: string;
  updatedAt: number;
};

type SessionPayload = {
  sessionId: string;
  user: SessionUser;
  workspace: SessionWorkspace;
  workspaces: SessionWorkspace[];
};

type SessionContextValue = {
  authenticated: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  session: SessionPayload | null;
};

const SessionContext = createContext<SessionContextValue | null>(null);

async function fetchSession(): Promise<SessionPayload | null> {
  const response = await fetch("/api/account/session", {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) {
    return null;
  }
  const payload = (await response.json()) as {
    authenticated?: boolean;
    session?: SessionPayload;
  };
  return payload.authenticated ? (payload.session ?? null) : null;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<SessionPayload | null>(null);

  const refresh = useCallback(async () => {
    const next = await fetchSession().catch(() => null);
    setSession(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<SessionContextValue>(
    () => ({
      authenticated: Boolean(session),
      loading,
      refresh,
      session,
    }),
    [loading, refresh, session],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useArkSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error("useArkSession must be used inside SessionProvider.");
  }
  return value;
}
