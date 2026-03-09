// @input: Text strings to hash
// @output: Hex digest strings
// @position: Hashing tools — Node.js crypto module only

import { createHash, scrypt, randomBytes } from "node:crypto";
import type { ToolManifest, ToolHandler, ToolRegistryEntry } from "@/lib/engine/types";
import { FAST_TIMEOUT_MS } from "@/lib/engine/types";

/* ── Helpers ── */

const ok = (text: string, start: number): ReturnType<ToolHandler> =>
  Promise.resolve({ status: "success", output: { text }, duration_ms: Date.now() - start });

const fail = (code: string, message: string, start: number): ReturnType<ToolHandler> =>
  Promise.resolve({ status: "failed", error: { code, message }, duration_ms: Date.now() - start });

const str = (params: Record<string, unknown>, key: string) => String(params[key] ?? "");

const hashWith = (algorithm: string, input: string): string =>
  createHash(algorithm).update(input, "utf8").digest("hex");

/* ── 12. MD5 ── */

const md5Manifest: ToolManifest = {
  id: "hash.md5",
  name: "MD5 Hash",
  description: "Generate MD5 hash of a string",
  category: "hash",
  tags: ["md5", "hash", "digest", "checksum"],
  params: [{ name: "input", type: "string", required: true, description: "Text to hash" }],
  output_type: "text",
  keywords: ["md5", "hash", "digest", "校验", "哈希"],
  patterns: ["md5.*hash", "hash.*md5", "md5"],
};

const md5Handler: ToolHandler = async (params) => {
  const start = Date.now();
  const input = str(params, "input");
  if (!input) return fail("EMPTY_INPUT", "Input cannot be empty", start);
  return ok(hashWith("md5", input), start);
};

export const md5Hash: ToolRegistryEntry = { manifest: md5Manifest, handler: md5Handler, timeout: FAST_TIMEOUT_MS };

/* ── 13. SHA-256 ── */

const sha256Manifest: ToolManifest = {
  id: "hash.sha256",
  name: "SHA-256 Hash",
  description: "Generate SHA-256 hash of a string",
  category: "hash",
  tags: ["sha256", "hash", "digest", "sha2"],
  params: [{ name: "input", type: "string", required: true, description: "Text to hash" }],
  output_type: "text",
  keywords: ["sha256", "sha-256", "hash", "digest", "哈希", "校验"],
  patterns: ["sha256.*hash", "hash.*sha256", "sha.?256"],
};

const sha256Handler: ToolHandler = async (params) => {
  const start = Date.now();
  const input = str(params, "input");
  if (!input) return fail("EMPTY_INPUT", "Input cannot be empty", start);
  return ok(hashWith("sha256", input), start);
};

export const sha256Hash: ToolRegistryEntry = { manifest: sha256Manifest, handler: sha256Handler, timeout: FAST_TIMEOUT_MS };

/* ── 14. SHA-512 ── */

const sha512Manifest: ToolManifest = {
  id: "hash.sha512",
  name: "SHA-512 Hash",
  description: "Generate SHA-512 hash of a string",
  category: "hash",
  tags: ["sha512", "hash", "digest", "sha2"],
  params: [{ name: "input", type: "string", required: true, description: "Text to hash" }],
  output_type: "text",
  keywords: ["sha512", "sha-512", "hash", "digest", "哈希", "校验"],
  patterns: ["sha512.*hash", "hash.*sha512", "sha.?512"],
};

const sha512Handler: ToolHandler = async (params) => {
  const start = Date.now();
  const input = str(params, "input");
  if (!input) return fail("EMPTY_INPUT", "Input cannot be empty", start);
  return ok(hashWith("sha512", input), start);
};

export const sha512Hash: ToolRegistryEntry = { manifest: sha512Manifest, handler: sha512Handler, timeout: FAST_TIMEOUT_MS };

/* ── 15. Bcrypt-equivalent (scrypt-based) ── */

const bcryptManifest: ToolManifest = {
  id: "hash.password",
  name: "Password Hash (scrypt)",
  description: "Hash a password using scrypt (bcrypt-equivalent, suitable for password storage)",
  category: "hash",
  tags: ["bcrypt", "scrypt", "password", "hash", "security"],
  params: [
    { name: "input", type: "string", required: true, description: "Password to hash" },
    { name: "verify", type: "string", required: false, description: "If provided, verify this hash against the input" },
  ],
  output_type: "text",
  keywords: ["bcrypt", "scrypt", "password", "hash", "密码", "哈希", "加密"],
  patterns: ["bcrypt", "password.*hash", "hash.*password"],
};

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 32;

const scryptHash = (password: string, salt: Buffer): Promise<string> =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LEN, SCRYPT_PARAMS, (err, key) => {
      if (err) reject(err);
      else resolve(`scrypt:${salt.toString("hex")}:${key.toString("hex")}`);
    });
  });

const scryptVerify = (password: string, stored: string): Promise<boolean> =>
  new Promise((resolve, reject) => {
    const parts = stored.split(":");
    if (parts.length !== 3 || parts[0] !== "scrypt") { resolve(false); return; }
    const salt = Buffer.from(parts[1], "hex");
    scrypt(password, salt, KEY_LEN, SCRYPT_PARAMS, (err, key) => {
      if (err) reject(err);
      else resolve(key.toString("hex") === parts[2]);
    });
  });

const bcryptHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const input = str(params, "input");
  if (!input) return fail("EMPTY_INPUT", "Password cannot be empty", start);
  const verify = str(params, "verify");
  if (verify) {
    const match = await scryptVerify(input, verify);
    return { status: "success", output: { text: match ? "MATCH" : "NO_MATCH", match }, duration_ms: Date.now() - start };
  }
  const salt = randomBytes(16);
  const hash = await scryptHash(input, salt);
  return { status: "success", output: { text: hash }, duration_ms: Date.now() - start };
};

export const bcryptHash: ToolRegistryEntry = { manifest: bcryptManifest, handler: bcryptHandler, timeout: FAST_TIMEOUT_MS };
