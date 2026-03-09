// @input: tenantId from API routes
// @output: Headed or headless XHS login sessions with cookie capture
// @position: Auth service — auto-detects headed (local) or headless (server) mode

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type AuthStatus = "waiting" | "success" | "failed" | "expired";
type AuthMode = "headed" | "headless";

type AuthResult =
  | { sessionId: string; mode: "headed" }
  | { sessionId: string; mode: "headless"; qrImageBase64: string };

type SessionState = {
  id: string;
  tenantId: string;
  status: AuthStatus;
  mode: AuthMode;
  qrImageBase64: string;
  createdAt: number;
};

const SESSION_TIMEOUT_MS = 3 * 60 * 1000;
const POLL_INTERVAL_MS = 2000;
const BROWSER_ARGS = ["--no-sandbox", "--disable-setuid-sandbox"];
const XHS_LOGIN_URL = "https://www.xiaohongshu.com/login";
const XHS_ORIGIN = "https://www.xiaohongshu.com";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/* ── File-based session storage ── */

const SESSION_DIR = join(
  process.env.OMNIAGENT_LOCAL_STATE_DIR?.trim() || join(process.cwd(), ".omniagent-state"),
  "xhs-auth-sessions",
);

function ensureDir(): void { mkdirSync(SESSION_DIR, { recursive: true }); }
function sessionPath(id: string): string { return join(SESSION_DIR, `${id}.json`); }

function writeSession(s: SessionState): void {
  ensureDir();
  writeFileSync(sessionPath(s.id), JSON.stringify(s), "utf8");
}

function readSession(id: string): SessionState | null {
  try { return JSON.parse(readFileSync(sessionPath(id), "utf8")) as SessionState; } catch { return null; }
}

function deleteSession(id: string): void {
  try { unlinkSync(sessionPath(id)); } catch { /* ok */ }
}

function listSessions(): SessionState[] {
  ensureDir();
  return readdirSync(SESSION_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => { try { return JSON.parse(readFileSync(join(SESSION_DIR, f), "utf8")) as SessionState; } catch { return null; } })
    .filter(Boolean) as SessionState[];
}

function cleanupStaleSessions(): void {
  const cutoff = Date.now() - SESSION_TIMEOUT_MS - 60_000;
  for (const s of listSessions()) {
    if (s.createdAt < cutoff) deleteSession(s.id);
  }
}

/* ── Browser context tracking ── */

const contextCleanups = new Map<string, () => Promise<void>>();

/* ── Headless singleton (shared across headless sessions) ── */

let headlessBrowserPromise: Promise<import("playwright").Browser> | null = null;

async function getHeadlessBrowser(): Promise<import("playwright").Browser> {
  if (!headlessBrowserPromise) {
    headlessBrowserPromise = (async () => {
      const { chromium } = await import("playwright");
      return chromium.launch({ headless: true, args: BROWSER_ARGS });
    })();
  }
  return headlessBrowserPromise;
}

/* ── Mode detection ── */

function detectAuthMode(): AuthMode {
  if (process.env.OMNIAGENT_HEADLESS_ONLY === "1") return "headless";
  if (process.platform === "win32" || process.platform === "darwin") return "headed";
  if (process.env.DISPLAY) return "headed";
  return "headless";
}

/* ── Shared helpers ── */

async function createContext(browser: import("playwright").Browser): Promise<import("playwright").BrowserContext> {
  return browser.newContext({ userAgent: USER_AGENT, viewport: { width: 1280, height: 800 } });
}

function capturePreWebSession(cookies: import("playwright").Cookie[]): string {
  return cookies.find((c) => c.name === "web_session")?.value ?? "";
}

function registerSession(sessionId: string, tenantId: string, mode: AuthMode, qr: string): void {
  writeSession({ id: sessionId, tenantId, status: "waiting", mode, qrImageBase64: qr, createdAt: Date.now() });
}

function expireSession(sessionId: string): void {
  const s = readSession(sessionId);
  if (s?.status === "waiting") { writeSession({ ...s, status: "expired" }); void cleanupSession(sessionId); }
}

/* ── Headed mode: visible browser window ── */

async function launchHeadedBrowser(tenantId: string, sessionId: string): Promise<void> {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: false, args: BROWSER_ARGS });
    const context = await createContext(browser);
    const page = await context.newPage();

    await page.goto(XHS_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const preCookies = await context.cookies(XHS_ORIGIN);
    const preWebSession = capturePreWebSession(preCookies);

    contextCleanups.set(sessionId, async () => { try { await browser.close(); } catch { /* ok */ } });

    page.on("close", () => {
      const s = readSession(sessionId);
      if (s?.status === "waiting") { writeSession({ ...s, status: "failed" }); void cleanupSession(sessionId); }
    });

    void pollForLogin(sessionId, context, preWebSession);
    setTimeout(() => expireSession(sessionId), SESSION_TIMEOUT_MS);
  } catch {
    const s = readSession(sessionId);
    if (s?.status === "waiting") writeSession({ ...s, status: "failed" });
  }
}

/* ── Headless mode: QR screenshot fallback ── */

async function startHeadless(tenantId: string, sessionId: string): Promise<string> {
  const browser = await getHeadlessBrowser();
  const context = await createContext(browser);
  const page = await context.newPage();

  try {
    await page.goto(XHS_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const qrEl = page.locator("img.qrcode-img, .qrcode img, img[src*='qrcode']").first();
    await qrEl.waitFor({ state: "visible", timeout: 15_000 });
    const shot = await qrEl.screenshot({ type: "png" });
    const qrBase64 = `data:image/png;base64,${shot.toString("base64")}`;

    const preCookies = await context.cookies(XHS_ORIGIN);
    const preWebSession = capturePreWebSession(preCookies);

    registerSession(sessionId, tenantId, "headless", qrBase64);
    contextCleanups.set(sessionId, async () => { try { await context.close(); } catch { /* ok */ } });

    void pollForLogin(sessionId, context, preWebSession);
    setTimeout(() => expireSession(sessionId), SESSION_TIMEOUT_MS);
    return qrBase64;
  } catch (err) {
    await context.close();
    throw new Error(`启动小红书登录失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/* ── Public API ── */

export async function startXhsAuth(tenantId: string): Promise<AuthResult> {
  cleanupStaleSessions();
  for (const s of listSessions()) {
    if (s.tenantId === tenantId) await abortSession(s.id);
  }

  const sessionId = randomUUID();
  const mode = detectAuthMode();

  if (mode === "headed") {
    registerSession(sessionId, tenantId, "headed", "");
    void launchHeadedBrowser(tenantId, sessionId);
    return { sessionId, mode: "headed" };
  }
  const qrImageBase64 = await startHeadless(tenantId, sessionId);
  return { sessionId, mode: "headless", qrImageBase64 };
}

export function getAuthStatus(sessionId: string): { status: AuthStatus; mode: AuthMode } | null {
  const session = readSession(sessionId);
  return session ? { status: session.status, mode: session.mode } : null;
}

export async function abortSession(sessionId: string): Promise<void> {
  await cleanupSession(sessionId);
}

/* ── Internal ── */

async function pollForLogin(sessionId: string, context: import("playwright").BrowserContext, preWebSession: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < SESSION_TIMEOUT_MS) {
    const session = readSession(sessionId);
    if (!session || session.status !== "waiting") return;

    try {
      const cookies = await context.cookies(XHS_ORIGIN);
      const webSession = cookies.find((c) => c.name === "web_session");
      if (webSession?.value && webSession.value !== preWebSession) {
        const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
        const { credentialStore } = await import("@/lib/server/credential-store");
        await credentialStore.upsert(session.tenantId, "xhs", cookieStr);
        writeSession({ ...session, status: "success" });
        void cleanupSession(sessionId);
        return;
      }
    } catch { /* page may have navigated */ }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

async function cleanupSession(sessionId: string): Promise<void> {
  const cleanup = contextCleanups.get(sessionId);
  if (cleanup) { await cleanup(); contextCleanups.delete(sessionId); }
  deleteSession(sessionId);
}
