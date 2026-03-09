// @input: tenantId + provider from auth flows and tool handlers
// @output: encrypted credential CRUD for per-tenant service connections
// @position: Storage layer — bridges XHS auth (and future providers) to tool execution

import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { getServerEnv } from "@/lib/server/env";

const KEY_FILE = join(
  process.env.OMNIAGENT_LOCAL_STATE_DIR?.trim() || join(process.cwd(), ".omniagent-state"),
  ".credential-key",
);

export type CredentialRecord = {
  tenantId: string;
  provider: string;
  credential: string;
  status: "active" | "expired";
  updatedAt: number;
};

type CredentialBackend = {
  get(tenantId: string, provider: string): Promise<CredentialRecord | null>;
  upsert(tenantId: string, provider: string, credential: string): Promise<void>;
  remove(tenantId: string, provider: string): Promise<void>;
  list(tenantId: string): Promise<CredentialRecord[]>;
  markExpired(tenantId: string, provider: string): Promise<void>;
};

/* ── Encryption (AES-256-GCM) ── */

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

const loadOrGenerateKey = (): Buffer => {
  if (existsSync(KEY_FILE)) {
    return Buffer.from(readFileSync(KEY_FILE, "utf8").trim(), "hex");
  }
  const key = randomBytes(32);
  mkdirSync(join(KEY_FILE, ".."), { recursive: true });
  writeFileSync(KEY_FILE, key.toString("hex"), { mode: 0o600, encoding: "utf8" });
  console.warn("[credential-store] Generated new credential key at", KEY_FILE, "— back this up!");
  return key;
};

const getEncryptionKey = (): Buffer => {
  const raw = process.env.OMNIAGENT_CREDENTIAL_KEY?.trim();
  if (raw) {
    const buf = Buffer.from(raw, "hex");
    if (buf.length === 32) return buf;
    console.warn("[credential-store] OMNIAGENT_CREDENTIAL_KEY is invalid (need 64 hex chars) — falling back to auto-generated key");
  }
  return loadOrGenerateKey();
};

const encrypt = (plaintext: string): string => {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${Buffer.concat([iv, tag, encrypted]).toString("base64")}`;
};

const decrypt = (stored: string): string => {
  if (!stored.startsWith("enc:")) return stored;
  const key = getEncryptionKey();
  const buf = Buffer.from(stored.slice(4), "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const encrypted = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
};

/* ── Local JSON backend ── */

const STORAGE_ROOT = process.env.OMNIAGENT_LOCAL_STATE_DIR?.trim() || join(process.cwd(), ".omniagent-state");
const CRED_DIR = join(STORAGE_ROOT, "credentials");

const sanitize = (s: string): string => s.replace(/[^a-zA-Z0-9_-]/g, "");

class LocalCredentialStore implements CredentialBackend {
  async get(tenantId: string, provider: string): Promise<CredentialRecord | null> {
    const path = this.filePath(tenantId, provider);
    if (!existsSync(path)) return null;
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as CredentialRecord;
      return { ...raw, credential: decrypt(raw.credential) };
    } catch { return null; }
  }

  async upsert(tenantId: string, provider: string, credential: string): Promise<void> {
    mkdirSync(this.tenantDir(tenantId), { recursive: true });
    const record: CredentialRecord = { tenantId, provider, credential: encrypt(credential), status: "active", updatedAt: Date.now() };
    const path = this.filePath(tenantId, provider);
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(record), "utf8");
    renameSync(tmp, path);
  }

  async remove(tenantId: string, provider: string): Promise<void> {
    try { unlinkSync(this.filePath(tenantId, provider)); } catch { /* ok */ }
  }

  async list(tenantId: string): Promise<CredentialRecord[]> {
    const dir = this.tenantDir(tenantId);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          const raw = JSON.parse(readFileSync(join(dir, f), "utf8")) as CredentialRecord;
          return { ...raw, credential: decrypt(raw.credential) };
        } catch { return null; }
      })
      .filter(Boolean) as CredentialRecord[];
  }

  async markExpired(tenantId: string, provider: string): Promise<void> {
    const existing = await this.get(tenantId, provider);
    if (!existing) return;
    // get() returns decrypted credential — re-encrypt before writing
    const record: CredentialRecord = { ...existing, credential: encrypt(existing.credential), status: "expired", updatedAt: Date.now() };
    writeFileSync(this.filePath(tenantId, provider), JSON.stringify(record), "utf8");
  }

  private tenantDir(tenantId: string): string {
    const safe = sanitize(tenantId);
    if (!safe) throw new Error("Invalid tenantId");
    return join(CRED_DIR, safe);
  }

  private filePath(tenantId: string, provider: string): string {
    const safeProvider = sanitize(provider);
    if (!safeProvider) throw new Error("Invalid provider");
    return join(this.tenantDir(tenantId), `${safeProvider}.json`);
  }
}

/* ── Postgres backend ── */

class PostgresCredentialStore implements CredentialBackend {
  private readonly pool: Pool;
  private schemaReady?: Promise<void>;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 4, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 3_000 });
  }

  async get(tenantId: string, provider: string): Promise<CredentialRecord | null> {
    await this.ensureSchema();
    const res = await this.pool.query<{ credential: string; status: string; updated_at: string }>(
      "SELECT credential, status, updated_at FROM omni_credentials WHERE tenant_id = $1 AND provider = $2",
      [tenantId, provider],
    );
    if (!res.rows[0]) return null;
    const row = res.rows[0];
    return { tenantId, provider, credential: decrypt(row.credential), status: row.status as "active" | "expired", updatedAt: Number(row.updated_at) };
  }

  async upsert(tenantId: string, provider: string, credential: string): Promise<void> {
    await this.ensureSchema();
    const now = Date.now();
    await this.pool.query(
      `INSERT INTO omni_credentials (tenant_id, provider, credential, status, updated_at)
       VALUES ($1, $2, $3, 'active', $4)
       ON CONFLICT (tenant_id, provider) DO UPDATE SET credential = $3, status = 'active', updated_at = $4`,
      [tenantId, provider, encrypt(credential), now],
    );
  }

  async remove(tenantId: string, provider: string): Promise<void> {
    await this.ensureSchema();
    await this.pool.query("DELETE FROM omni_credentials WHERE tenant_id = $1 AND provider = $2", [tenantId, provider]);
  }

  async list(tenantId: string): Promise<CredentialRecord[]> {
    await this.ensureSchema();
    const res = await this.pool.query<{ provider: string; credential: string; status: string; updated_at: string }>(
      "SELECT provider, credential, status, updated_at FROM omni_credentials WHERE tenant_id = $1",
      [tenantId],
    );
    return res.rows.map((r) => ({ tenantId, provider: r.provider, credential: decrypt(r.credential), status: r.status as "active" | "expired", updatedAt: Number(r.updated_at) }));
  }

  async markExpired(tenantId: string, provider: string): Promise<void> {
    await this.ensureSchema();
    await this.pool.query("UPDATE omni_credentials SET status = 'expired', updated_at = $3 WHERE tenant_id = $1 AND provider = $2", [tenantId, provider, Date.now()]);
  }

  private async ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = this.pool.query(`
        CREATE TABLE IF NOT EXISTS omni_credentials (
          tenant_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          credential TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          updated_at BIGINT NOT NULL,
          PRIMARY KEY (tenant_id, provider)
        );
      `).then(() => undefined);
    }
    await this.schemaReady;
  }
}

/* ── Factory ── */

const createCredentialStore = (): CredentialBackend => {
  const env = getServerEnv();
  if (env.usageStore === "postgres" && env.databaseUrl) {
    return new PostgresCredentialStore(env.databaseUrl);
  }
  return new LocalCredentialStore();
};

export const credentialStore = createCredentialStore();
