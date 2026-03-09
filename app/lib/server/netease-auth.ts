// @input: tenantId from API routes and optional sessionId for polling
// @output: NetEase QR auth sessions backed by real local credential storage
// @position: Auth service - QR start, poll, persist, and connection inspection

import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  createAnonymousNeteaseSession,
  fetchNeteaseAccountSummary,
  loadNeteaseApi,
  type NeteaseAccountSummary,
} from "@/lib/music/netease";
import { credentialStore } from "@/lib/server/credential-store";

type AuthStatus = "waiting" | "confirm" | "success" | "failed" | "expired";

type SessionState = {
  id: string;
  tenantId: string;
  key: string;
  qrImageBase64: string;
  qrUrl: string;
  status: AuthStatus;
  createdAt: number;
  account?: NeteaseAccountSummary | null;
};

export type NeteaseAuthStartResult = {
  sessionId: string;
  status: AuthStatus;
  qrImageBase64: string;
  qrUrl: string;
};

export type NeteaseAuthStatusResult = {
  sessionId: string;
  status: AuthStatus;
  qrImageBase64: string;
  qrUrl: string;
  account?: NeteaseAccountSummary | null;
};

export type NeteaseConnectionResult = {
  provider: "netease";
  connected: boolean;
  status: "active" | "expired" | "none";
  account?: NeteaseAccountSummary | null;
};

export type NeteaseSeedResult = {
  provider: "netease";
  connected: boolean;
  status: "active";
  account?: NeteaseAccountSummary | null;
  source: "env_cookie" | "anonymous_guest";
};

const SESSION_TIMEOUT_MS = 3 * 60 * 1000;
const SESSION_DIR = join(
  process.env.OMNIAGENT_LOCAL_STATE_DIR?.trim() || join(process.cwd(), ".omniagent-state"),
  "netease-auth-sessions",
);

function ensureDir(): void {
  mkdirSync(SESSION_DIR, { recursive: true });
}

function sessionPath(id: string): string {
  return join(SESSION_DIR, `${id}.json`);
}

function writeSession(session: SessionState): void {
  ensureDir();
  writeFileSync(sessionPath(session.id), JSON.stringify(session), "utf8");
}

function readSession(id: string): SessionState | null {
  try {
    return JSON.parse(readFileSync(sessionPath(id), "utf8")) as SessionState;
  } catch {
    return null;
  }
}

function deleteSession(id: string): void {
  try {
    unlinkSync(sessionPath(id));
  } catch {
    // ok
  }
}

function listSessions(): SessionState[] {
  ensureDir();
  return readdirSync(SESSION_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      try {
        return JSON.parse(
          readFileSync(join(SESSION_DIR, name), "utf8"),
        ) as SessionState;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as SessionState[];
}

function cleanupStaleSessions(): void {
  const cutoff = Date.now() - SESSION_TIMEOUT_MS - 60_000;
  for (const session of listSessions()) {
    if (session.createdAt < cutoff) {
      deleteSession(session.id);
    }
  }
}

export async function startNeteaseAuth(
  tenantId: string,
): Promise<NeteaseAuthStartResult> {
  cleanupStaleSessions();
  for (const session of listSessions()) {
    if (session.tenantId === tenantId) {
      deleteSession(session.id);
    }
  }

  const api = await loadNeteaseApi();
  const keyResponse = (await api.login_qr_key({
    timestamp: Date.now(),
  } as any)) as {
    body?: { data?: { unikey?: string } };
  };
  const key = keyResponse.body?.data?.unikey?.trim();
  if (!key) {
    throw new Error("Failed to create NetEase QR key.");
  }

  const qrResponse = (await api.login_qr_create({
    key,
    qrimg: true,
    platform: "web",
    timestamp: Date.now(),
  } as any)) as {
    body?: { data?: { qrimg?: string; qrurl?: string } };
  };
  const qrImageBase64 = qrResponse.body?.data?.qrimg?.trim();
  const qrUrl = qrResponse.body?.data?.qrurl?.trim();
  if (!qrImageBase64 || !qrUrl) {
    throw new Error("Failed to generate NetEase QR image.");
  }

  const session: SessionState = {
    id: randomUUID(),
    tenantId,
    key,
    qrImageBase64,
    qrUrl,
    status: "waiting",
    createdAt: Date.now(),
    account: null,
  };
  writeSession(session);
  return {
    sessionId: session.id,
    status: session.status,
    qrImageBase64: session.qrImageBase64,
    qrUrl: session.qrUrl,
  };
}

export async function getNeteaseAuthStatus(
  sessionId: string,
): Promise<NeteaseAuthStatusResult | null> {
  const existing = readSession(sessionId);
  if (!existing) {
    return null;
  }

  let session = existing;
  if (Date.now() - session.createdAt > SESSION_TIMEOUT_MS) {
    session = { ...session, status: "expired" };
    writeSession(session);
  } else if (session.status === "waiting" || session.status === "confirm") {
    session = await refreshSession(session);
  }

  return {
    sessionId: session.id,
    status: session.status,
    qrImageBase64: session.qrImageBase64,
    qrUrl: session.qrUrl,
    account: session.account ?? null,
  };
}

export async function getNeteaseConnection(
  tenantId: string,
): Promise<NeteaseConnectionResult> {
  const existing = await credentialStore.get(tenantId, "netease");
  if (!existing) {
    return { provider: "netease", connected: false, status: "none" };
  }
  if (existing.status !== "active") {
    return { provider: "netease", connected: false, status: existing.status };
  }

  try {
    const account = await fetchNeteaseAccountSummary(existing.credential);
    if (!account) {
      await credentialStore.markExpired(tenantId, "netease");
      return { provider: "netease", connected: false, status: "expired" };
    }
    return {
      provider: "netease",
      connected: true,
      status: "active",
      account,
    };
  } catch {
    await credentialStore.markExpired(tenantId, "netease");
    return { provider: "netease", connected: false, status: "expired" };
  }
}

export async function seedNeteaseConnection(
  tenantId: string,
): Promise<NeteaseSeedResult> {
  const envCookie = process.env.OMNIAGENT_NETEASE_COOKIE?.trim();
  if (envCookie) {
    await credentialStore.upsert(tenantId, "netease", envCookie);
    const account = await fetchNeteaseAccountSummary(envCookie);
    syncSeededSessionSuccess(tenantId, account);
    return {
      provider: "netease",
      connected: true,
      status: "active",
      account,
      source: "env_cookie",
    };
  }

  const anonymous = await createAnonymousNeteaseSession();
  await credentialStore.upsert(tenantId, "netease", anonymous.cookie);
  syncSeededSessionSuccess(tenantId, anonymous.account);
  return {
    provider: "netease",
    connected: true,
    status: "active",
    account: anonymous.account,
    source: "anonymous_guest",
  };
}

async function refreshSession(session: SessionState): Promise<SessionState> {
  try {
    const api = await loadNeteaseApi();
    const result = (await api.login_qr_check({
      key: session.key,
      timestamp: Date.now(),
    } as any)) as {
      body?: { code?: number; cookie?: string };
    };
    const code = Number(result.body?.code ?? 0);
    let next: SessionState = session;

    if (code === 801) {
      next = { ...session, status: "waiting" };
    } else if (code === 802) {
      next = { ...session, status: "confirm" };
    } else if (code === 803) {
      const cookie = result.body?.cookie?.trim();
      if (!cookie) {
        next = { ...session, status: "failed" };
      } else {
        await credentialStore.upsert(session.tenantId, "netease", cookie);
        const account = await fetchNeteaseAccountSummary(cookie);
        next = {
          ...session,
          status: account ? "success" : "failed",
          account,
        };
      }
    } else if (code === 800) {
      next = { ...session, status: "expired" };
    } else if (code > 0) {
      next = { ...session, status: "failed" };
    }

    writeSession(next);
    return next;
  } catch {
    const failed = { ...session, status: "failed" as const };
    writeSession(failed);
    return failed;
  }
}

function syncSeededSessionSuccess(
  tenantId: string,
  account: NeteaseAccountSummary | null,
): void {
  const latest = listSessions()
    .filter((session) => session.tenantId === tenantId)
    .sort((left, right) => right.createdAt - left.createdAt)[0];
  if (!latest) {
    return;
  }
  writeSession({
    ...latest,
    status: "success",
    account,
  });
}
