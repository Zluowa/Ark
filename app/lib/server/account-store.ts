import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { apiKeyRegistry } from "@/lib/server/api-key-registry";
import { tenantRegistry } from "@/lib/server/tenant-registry";

const STORAGE_ROOT =
  process.env.OMNIAGENT_LOCAL_STATE_DIR?.trim() ||
  join(process.cwd(), ".omniagent-state");
const CONTROL_PLANE_DIR = join(STORAGE_ROOT, "control-plane");
const ACCOUNTS_FILE = join(CONTROL_PLANE_DIR, "accounts.json");
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export type WorkspaceRole = "owner" | "member";

type UserRecord = {
  createdAt: number;
  displayName: string;
  email: string;
  id: string;
  passwordHash: string;
  status: "active";
  updatedAt: number;
};

type WorkspaceRecord = {
  createdAt: number;
  id: string;
  name: string;
  ownerUserId: string;
  slug: string;
  status: "active";
  tenantId: string;
  updatedAt: number;
};

type MembershipRecord = {
  createdAt: number;
  role: WorkspaceRole;
  userId: string;
  workspaceId: string;
};

type SessionRecord = {
  createdAt: number;
  expiresAt: number;
  id: string;
  lastSeenAt: number;
  tokenHash: string;
  userId: string;
  workspaceId: string;
};

type AccountState = {
  memberships: MembershipRecord[];
  sessions: SessionRecord[];
  users: UserRecord[];
  workspaces: WorkspaceRecord[];
};

export type AccountUser = {
  createdAt: number;
  displayName: string;
  email: string;
  id: string;
};

export type WorkspaceSummary = {
  createdAt: number;
  id: string;
  isActive: boolean;
  name: string;
  role: WorkspaceRole;
  slug: string;
  tenantId: string;
  updatedAt: number;
};

export type AccountSession = {
  sessionId: string;
  user: AccountUser;
  workspace: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
};

export type DeleteAccountResult = {
  suspendedTenantIds: string[];
  userId: string;
  workspaceIds: string[];
};

type RegisterInput = {
  displayName?: string;
  email: string;
  password: string;
  workspaceName?: string;
};

type LoginInput = {
  email: string;
  password: string;
};

const EMPTY_STATE: AccountState = {
  memberships: [],
  sessions: [],
  users: [],
  workspaces: [],
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeEmail = (value: string): string => value.trim().toLowerCase();

const slugify = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "workspace";

const randomId = (prefix: string): string =>
  `${prefix}_${randomBytes(8).toString("hex")}`;

const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

const hashPassword = (password: string): string => {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${derived}`;
};

const verifyPassword = (password: string, stored: string): boolean => {
  const [scheme, salt, expected] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !expected) {
    return false;
  }
  const actual = scryptSync(password, salt, 64).toString("hex");
  const actualBuf = Buffer.from(actual, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (actualBuf.length !== expectedBuf.length) {
    return false;
  }
  return timingSafeEqual(actualBuf, expectedBuf);
};

const sanitizeUser = (value: unknown): UserRecord | null => {
  if (!isObject(value)) {
    return null;
  }
  if (
    typeof value.id !== "string" ||
    typeof value.email !== "string" ||
    typeof value.displayName !== "string" ||
    typeof value.passwordHash !== "string" ||
    typeof value.createdAt !== "number" ||
    typeof value.updatedAt !== "number"
  ) {
    return null;
  }
  return {
    createdAt: Math.floor(value.createdAt),
    displayName: value.displayName.trim() || "Ark User",
    email: normalizeEmail(value.email),
    id: value.id.trim(),
    passwordHash: value.passwordHash,
    status: "active",
    updatedAt: Math.floor(value.updatedAt),
  };
};

const sanitizeWorkspace = (value: unknown): WorkspaceRecord | null => {
  if (!isObject(value)) {
    return null;
  }
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.slug !== "string" ||
    typeof value.tenantId !== "string" ||
    typeof value.ownerUserId !== "string" ||
    typeof value.createdAt !== "number" ||
    typeof value.updatedAt !== "number"
  ) {
    return null;
  }
  return {
    createdAt: Math.floor(value.createdAt),
    id: value.id.trim(),
    name: value.name.trim() || "Workspace",
    ownerUserId: value.ownerUserId.trim(),
    slug: value.slug.trim() || "workspace",
    status: "active",
    tenantId: value.tenantId.trim(),
    updatedAt: Math.floor(value.updatedAt),
  };
};

const sanitizeMembership = (value: unknown): MembershipRecord | null => {
  if (!isObject(value)) {
    return null;
  }
  if (
    typeof value.userId !== "string" ||
    typeof value.workspaceId !== "string" ||
    typeof value.createdAt !== "number"
  ) {
    return null;
  }
  return {
    createdAt: Math.floor(value.createdAt),
    role: value.role === "member" ? "member" : "owner",
    userId: value.userId.trim(),
    workspaceId: value.workspaceId.trim(),
  };
};

const sanitizeSession = (value: unknown): SessionRecord | null => {
  if (!isObject(value)) {
    return null;
  }
  if (
    typeof value.id !== "string" ||
    typeof value.userId !== "string" ||
    typeof value.workspaceId !== "string" ||
    typeof value.tokenHash !== "string" ||
    typeof value.createdAt !== "number" ||
    typeof value.lastSeenAt !== "number" ||
    typeof value.expiresAt !== "number"
  ) {
    return null;
  }
  return {
    createdAt: Math.floor(value.createdAt),
    expiresAt: Math.floor(value.expiresAt),
    id: value.id.trim(),
    lastSeenAt: Math.floor(value.lastSeenAt),
    tokenHash: value.tokenHash.trim(),
    userId: value.userId.trim(),
    workspaceId: value.workspaceId.trim(),
  };
};

const sanitizeState = (value: unknown): AccountState => {
  if (!isObject(value)) {
    return { ...EMPTY_STATE };
  }
  return {
    users: Array.isArray(value.users)
      ? value.users.map(sanitizeUser).filter((item): item is UserRecord => Boolean(item))
      : [],
    workspaces: Array.isArray(value.workspaces)
      ? value.workspaces
          .map(sanitizeWorkspace)
          .filter((item): item is WorkspaceRecord => Boolean(item))
      : [],
    memberships: Array.isArray(value.memberships)
      ? value.memberships
          .map(sanitizeMembership)
          .filter((item): item is MembershipRecord => Boolean(item))
      : [],
    sessions: Array.isArray(value.sessions)
      ? value.sessions
          .map(sanitizeSession)
          .filter((item): item is SessionRecord => Boolean(item))
      : [],
  };
};

const toUser = (record: UserRecord): AccountUser => ({
  createdAt: record.createdAt,
  displayName: record.displayName,
  email: record.email,
  id: record.id,
});

class LocalAccountStore {
  private readState(): AccountState {
    if (!existsSync(ACCOUNTS_FILE)) {
      return { ...EMPTY_STATE };
    }
    try {
      const parsed = JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8")) as unknown;
      return sanitizeState(parsed);
    } catch {
      return { ...EMPTY_STATE };
    }
  }

  private writeState(state: AccountState): void {
    mkdirSync(CONTROL_PLANE_DIR, { recursive: true });
    const tmp = `${ACCOUNTS_FILE}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
    renameSync(tmp, ACCOUNTS_FILE);
  }

  private pruneExpiredSessions(state: AccountState): AccountState {
    const now = Date.now();
    return {
      ...state,
      sessions: state.sessions.filter((session) => session.expiresAt > now),
    };
  }

  private ensureTenant(workspace: WorkspaceRecord): void {
    const existing = tenantRegistry.get(workspace.tenantId);
    if (existing) {
      return;
    }
    tenantRegistry.create({
      createdBy: workspace.ownerUserId,
      id: workspace.tenantId,
      name: workspace.name,
    });
  }

  private workspaceRole(state: AccountState, userId: string, workspaceId: string): WorkspaceRole | null {
    return (
      state.memberships.find(
        (membership) =>
          membership.userId === userId && membership.workspaceId === workspaceId,
      )?.role ?? null
    );
  }

  private listWorkspaceSummaries(
    state: AccountState,
    userId: string,
    activeWorkspaceId: string,
  ): WorkspaceSummary[] {
    const memberships = state.memberships.filter((membership) => membership.userId === userId);
    return memberships
      .map((membership) => {
        const workspace = state.workspaces.find((item) => item.id === membership.workspaceId);
        if (!workspace) {
          return null;
        }
        return {
          createdAt: workspace.createdAt,
          id: workspace.id,
          isActive: workspace.id === activeWorkspaceId,
          name: workspace.name,
          role: membership.role,
          slug: workspace.slug,
          tenantId: workspace.tenantId,
          updatedAt: workspace.updatedAt,
        };
      })
      .filter((item): item is WorkspaceSummary => Boolean(item))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private buildSession(state: AccountState, session: SessionRecord): AccountSession | null {
    const user = state.users.find((item) => item.id === session.userId);
    const workspace = state.workspaces.find((item) => item.id === session.workspaceId);
    if (!user || !workspace) {
      return null;
    }
    const role = this.workspaceRole(state, user.id, workspace.id);
    if (!role) {
      return null;
    }
    return {
      sessionId: session.id,
      user: toUser(user),
      workspace: {
        createdAt: workspace.createdAt,
        id: workspace.id,
        isActive: true,
        name: workspace.name,
        role,
        slug: workspace.slug,
        tenantId: workspace.tenantId,
        updatedAt: workspace.updatedAt,
      },
      workspaces: this.listWorkspaceSummaries(state, user.id, workspace.id),
    };
  }

  private suspendWorkspaceTenants(tenantIds: readonly string[]): void {
    for (const tenantId of tenantIds) {
      if (!tenantId.trim()) {
        continue;
      }
      tenantRegistry.update(tenantId, { status: "suspended" });
      const keys = apiKeyRegistry.list({ tenantId });
      for (const key of keys) {
        if (key.revocable && key.status === "active") {
          apiKeyRegistry.revoke(key.id);
        }
      }
    }
  }

  private createWorkspaceRecord(
    state: AccountState,
    userId: string,
    name: string,
  ): WorkspaceRecord {
    const now = Date.now();
    const slugBase = slugify(name);
    const id = `${slugBase}-${randomBytes(4).toString("hex")}`;
    const workspace: WorkspaceRecord = {
      createdAt: now,
      id,
      name: name.trim() || "Workspace",
      ownerUserId: userId,
      slug: slugBase,
      status: "active",
      tenantId: id,
      updatedAt: now,
    };
    state.workspaces.push(workspace);
    state.memberships.push({
      createdAt: now,
      role: "owner",
      userId,
      workspaceId: workspace.id,
    });
    this.ensureTenant(workspace);
    return workspace;
  }

  private createSessionRecord(
    state: AccountState,
    userId: string,
    workspaceId: string,
  ): { record: SessionRecord; token: string } {
    const now = Date.now();
    const token = `ark_sess_${randomBytes(24).toString("hex")}`;
    const record: SessionRecord = {
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
      id: randomId("sess"),
      lastSeenAt: now,
      tokenHash: hashToken(token),
      userId,
      workspaceId,
    };
    state.sessions.push(record);
    return { record, token };
  }

  register(input: RegisterInput): { session: AccountSession; sessionToken: string } {
    const email = normalizeEmail(input.email);
    const password = input.password.trim();
    const displayName = input.displayName?.trim() || email.split("@")[0] || "Ark User";
    const workspaceName =
      input.workspaceName?.trim() || `${displayName}'s Workspace`;

    if (!email || !email.includes("@")) {
      throw new Error("A valid email is required.");
    }
    if (password.length < 8) {
      throw new Error("Password must be at least 8 characters.");
    }

    const state = this.pruneExpiredSessions(this.readState());
    if (state.users.some((user) => user.email === email)) {
      throw new Error("An account with this email already exists.");
    }

    const now = Date.now();
    const user: UserRecord = {
      createdAt: now,
      displayName,
      email,
      id: randomId("user"),
      passwordHash: hashPassword(password),
      status: "active",
      updatedAt: now,
    };
    state.users.push(user);

    const workspace = this.createWorkspaceRecord(state, user.id, workspaceName);
    const { record, token } = this.createSessionRecord(state, user.id, workspace.id);
    this.writeState(state);

    const session = this.buildSession(state, record);
    if (!session) {
      throw new Error("Failed to create account session.");
    }
    return { session, sessionToken: token };
  }

  login(input: LoginInput): { session: AccountSession; sessionToken: string } {
    const email = normalizeEmail(input.email);
    const password = input.password.trim();
    const state = this.pruneExpiredSessions(this.readState());
    const user = state.users.find((item) => item.email === email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new Error("Invalid email or password.");
    }
    const activeWorkspace =
      state.memberships.find((membership) => membership.userId === user.id)?.workspaceId ??
      state.workspaces.find((workspace) => workspace.ownerUserId === user.id)?.id;
    if (!activeWorkspace) {
      throw new Error("No workspace found for this account.");
    }
    state.sessions = state.sessions.filter((session) => session.userId !== user.id);
    const { record, token } = this.createSessionRecord(state, user.id, activeWorkspace);
    this.writeState(state);
    const session = this.buildSession(state, record);
    if (!session) {
      throw new Error("Failed to create account session.");
    }
    return { session, sessionToken: token };
  }

  getSessionByToken(token: string | undefined): AccountSession | null {
    const trimmed = token?.trim();
    if (!trimmed) {
      return null;
    }
    const state = this.pruneExpiredSessions(this.readState());
    const tokenHash = hashToken(trimmed);
    const sessionIndex = state.sessions.findIndex((session) => session.tokenHash === tokenHash);
    if (sessionIndex < 0) {
      return null;
    }
    const session = state.sessions[sessionIndex];
    const now = Date.now();
    if (now - session.lastSeenAt >= SESSION_TOUCH_INTERVAL_MS) {
      state.sessions[sessionIndex] = {
        ...session,
        expiresAt: now + SESSION_TTL_MS,
        lastSeenAt: now,
      };
      this.writeState(state);
    }
    return this.buildSession(state, state.sessions[sessionIndex]) ?? null;
  }

  logoutByToken(token: string | undefined): void {
    const trimmed = token?.trim();
    if (!trimmed) {
      return;
    }
    const state = this.readState();
    const tokenHash = hashToken(trimmed);
    const nextSessions = state.sessions.filter((session) => session.tokenHash !== tokenHash);
    if (nextSessions.length === state.sessions.length) {
      return;
    }
    this.writeState({ ...state, sessions: nextSessions });
  }

  createWorkspace(userId: string, name: string): WorkspaceSummary {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error("Workspace name is required.");
    }
    const state = this.pruneExpiredSessions(this.readState());
    const user = state.users.find((item) => item.id === userId);
    if (!user) {
      throw new Error("User not found.");
    }
    const workspace = this.createWorkspaceRecord(state, user.id, trimmedName);
    this.writeState(state);
    return {
      createdAt: workspace.createdAt,
      id: workspace.id,
      isActive: false,
      name: workspace.name,
      role: "owner",
      slug: workspace.slug,
      tenantId: workspace.tenantId,
      updatedAt: workspace.updatedAt,
    };
  }

  switchWorkspace(token: string | undefined, workspaceId: string): AccountSession {
    const trimmedToken = token?.trim();
    const trimmedWorkspaceId = workspaceId.trim();
    if (!trimmedToken) {
      throw new Error("Session token is required.");
    }
    if (!trimmedWorkspaceId) {
      throw new Error("Workspace id is required.");
    }
    const state = this.pruneExpiredSessions(this.readState());
    const tokenHash = hashToken(trimmedToken);
    const sessionIndex = state.sessions.findIndex((session) => session.tokenHash === tokenHash);
    if (sessionIndex < 0) {
      throw new Error("Session not found.");
    }
    const session = state.sessions[sessionIndex];
    const role = this.workspaceRole(state, session.userId, trimmedWorkspaceId);
    if (!role) {
      throw new Error("Workspace access denied.");
    }
    const now = Date.now();
    state.sessions[sessionIndex] = {
      ...session,
      expiresAt: now + SESSION_TTL_MS,
      lastSeenAt: now,
      workspaceId: trimmedWorkspaceId,
    };
    this.writeState(state);
    const next = this.buildSession(state, state.sessions[sessionIndex]);
    if (!next) {
      throw new Error("Failed to switch workspace.");
    }
    return next;
  }

  deleteAccountByToken(token: string | undefined): DeleteAccountResult {
    const trimmed = token?.trim();
    if (!trimmed) {
      throw new Error("Session token is required.");
    }

    const state = this.pruneExpiredSessions(this.readState());
    const tokenHash = hashToken(trimmed);
    const session = state.sessions.find((item) => item.tokenHash === tokenHash);
    if (!session) {
      throw new Error("Session not found.");
    }

    const user = state.users.find((item) => item.id === session.userId);
    if (!user) {
      throw new Error("User not found.");
    }

    const workspaceIds = Array.from(
      new Set(
        state.workspaces
          .filter((workspace) => workspace.ownerUserId === user.id)
          .map((workspace) => workspace.id),
      ),
    );
    const suspendedTenantIds = Array.from(
      new Set(
        state.workspaces
          .filter((workspace) => workspaceIds.includes(workspace.id))
          .map((workspace) => workspace.tenantId.trim())
          .filter(Boolean),
      ),
    );

    state.sessions = state.sessions.filter(
      (item) => item.userId !== user.id && !workspaceIds.includes(item.workspaceId),
    );
    state.memberships = state.memberships.filter(
      (item) => item.userId !== user.id && !workspaceIds.includes(item.workspaceId),
    );
    state.workspaces = state.workspaces.filter(
      (workspace) => !workspaceIds.includes(workspace.id),
    );
    state.users = state.users.filter((item) => item.id !== user.id);

    this.writeState(state);
    this.suspendWorkspaceTenants(suspendedTenantIds);

    return {
      suspendedTenantIds,
      userId: user.id,
      workspaceIds,
    };
  }
}

export const accountStore = new LocalAccountStore();
