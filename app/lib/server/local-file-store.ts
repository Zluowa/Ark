// @input: local file paths from tool handlers
// @output: UUID keys → HTTP-servable /api/v1/files/{key} URLs
// @position: In-memory file registry bridging noop artifact store to HTTP serve layer

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";

const TTL_MS = 60 * 60 * 1000;
const STORE_DIR = join(tmpdir(), "omniagent-local-file-store");

type Entry = { path: string; contentType: string; filename: string; createdAt: number };

const store = new Map<string, Entry>();

const ensureStoreDir = (): void => {
  mkdirSync(STORE_DIR, { recursive: true });
};

const metaPath = (key: string): string => join(STORE_DIR, `${key}.json`);

const writeMeta = (key: string, entry: Entry): void => {
  try {
    ensureStoreDir();
    writeFileSync(metaPath(key), JSON.stringify(entry), "utf8");
  } catch {
    // best-effort metadata cache
  }
};

const readMeta = (key: string): Entry | null => {
  try {
    const raw = readFileSync(metaPath(key), "utf8");
    const parsed = JSON.parse(raw) as Entry;
    if (
      !parsed ||
      typeof parsed.path !== "string" ||
      typeof parsed.contentType !== "string" ||
      typeof parsed.filename !== "string" ||
      typeof parsed.createdAt !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const deleteMeta = (key: string): void => {
  try {
    unlinkSync(metaPath(key));
  } catch {
    // ignore
  }
};

const TYPES: Record<string, string> = {
  pdf: "application/pdf", zip: "application/zip",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  svg: "image/svg+xml", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
  avi: "video/x-msvideo", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4",
  json: "application/json", csv: "text/csv", txt: "text/plain",
};

export function register(localPath: string, filename?: string): string {
  const ext = extname(localPath).replace(/^\./, "").toLowerCase();
  const key = randomUUID();
  const entry = {
    path: localPath,
    contentType: TYPES[ext] ?? "application/octet-stream",
    filename: filename ?? basename(localPath),
    createdAt: Date.now(),
  };
  store.set(key, entry);
  writeMeta(key, entry);
  return `/api/v1/files/${key}`;
}

export function resolve(key: string): Entry | null {
  let entry = store.get(key);
  if (!entry) {
    const fromDisk = readMeta(key);
    if (fromDisk) {
      store.set(key, fromDisk);
      entry = fromDisk;
    }
  }
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    store.delete(key);
    deleteMeta(key);
    try { unlinkSync(entry.path); } catch { /* best-effort */ }
    return null;
  }
  if (!existsSync(entry.path)) {
    store.delete(key);
    deleteMeta(key);
    return null;
  }
  return entry;
}

function sweep(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [key, entry] of store) {
    if (entry.createdAt < cutoff) {
      store.delete(key);
      try { unlinkSync(entry.path); } catch { /* best-effort */ }
    }
  }
  ensureStoreDir();
  for (const file of readdirSync(STORE_DIR)) {
    if (!file.endsWith(".json")) continue;
    const key = file.replace(/\.json$/, "");
    const entry = readMeta(key);
    if (!entry) continue;
    if (entry.createdAt < cutoff) {
      deleteMeta(key);
      try { unlinkSync(entry.path); } catch { /* best-effort */ }
    }
  }
}

const timer = setInterval(sweep, TTL_MS / 2);
if (typeof timer === "object" && "unref" in timer) timer.unref();
