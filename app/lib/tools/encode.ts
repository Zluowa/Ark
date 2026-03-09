// @input: Text strings, Base64 strings, URLs, JWT tokens
// @output: Encoded/decoded strings
// @position: Encoding/decoding tools — Node.js built-ins only

import type { ToolManifest, ToolHandler, ToolRegistryEntry } from "@/lib/engine/types";
import { FAST_TIMEOUT_MS } from "@/lib/engine/types";

/* ── Helpers ── */

const ok = (text: string, start: number): ReturnType<ToolHandler> =>
  Promise.resolve({ status: "success", output: { text }, duration_ms: Date.now() - start });

const fail = (code: string, message: string, start: number): ReturnType<ToolHandler> =>
  Promise.resolve({ status: "failed", error: { code, message }, duration_ms: Date.now() - start });

const str = (params: Record<string, unknown>, key: string) => String(params[key] ?? "");

/* ── 7. Text → Base64 ── */

const base64EncodeManifest: ToolManifest = {
  id: "encode.base64",
  name: "Text to Base64",
  description: "Encode text string to Base64",
  category: "encode",
  tags: ["base64", "encode", "text"],
  params: [{ name: "input", type: "string", required: true, description: "Text to encode" }],
  output_type: "text",
  keywords: ["base64", "encode", "编码", "加密", "转码"],
  patterns: ["base64.*encode", "encode.*base64", "text.*base64"],
};

const base64EncodeHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const input = str(params, "input");
  if (!input) return fail("EMPTY_INPUT", "Input cannot be empty", start);
  return ok(Buffer.from(input, "utf8").toString("base64"), start);
};

export const base64Encode: ToolRegistryEntry = { manifest: base64EncodeManifest, handler: base64EncodeHandler, timeout: FAST_TIMEOUT_MS };

/* ── 8. Base64 → Text ── */

const base64DecodeManifest: ToolManifest = {
  id: "decode.base64",
  name: "Base64 to Text",
  description: "Decode Base64 string to text",
  category: "encode",
  tags: ["base64", "decode", "text"],
  params: [{ name: "input", type: "string", required: true, description: "Base64 string to decode" }],
  output_type: "text",
  keywords: ["base64", "decode", "解码", "解密", "转码"],
  patterns: ["base64.*decode", "decode.*base64"],
};

const base64DecodeHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const input = str(params, "input").trim();
  if (!input) return fail("EMPTY_INPUT", "Input cannot be empty", start);
  try {
    const decoded = Buffer.from(input, "base64").toString("utf8");
    // Validate it was actual base64 by re-encoding
    if (Buffer.from(decoded, "utf8").toString("base64").replace(/=/g, "") !== input.replace(/=/g, "")) {
      return fail("INVALID_BASE64", "Input does not appear to be valid Base64", start);
    }
    return ok(decoded, start);
  } catch {
    return fail("DECODE_ERROR", "Failed to decode Base64 string", start);
  }
};

export const base64Decode: ToolRegistryEntry = { manifest: base64DecodeManifest, handler: base64DecodeHandler, timeout: FAST_TIMEOUT_MS };

/* ── 9. URL Encode ── */

const urlEncodeManifest: ToolManifest = {
  id: "encode.url",
  name: "URL Encode",
  description: "URL-encode a string (percent encoding)",
  category: "encode",
  tags: ["url", "encode", "percent", "uri"],
  params: [{ name: "input", type: "string", required: true, description: "Text to URL-encode" }],
  output_type: "text",
  keywords: ["url", "encode", "percent", "uri", "编码", "转义"],
  patterns: ["url.*encode", "encode.*url", "percent.*encode"],
};

const urlEncodeHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const input = str(params, "input");
  if (!input) return fail("EMPTY_INPUT", "Input cannot be empty", start);
  return ok(encodeURIComponent(input), start);
};

export const urlEncode: ToolRegistryEntry = { manifest: urlEncodeManifest, handler: urlEncodeHandler, timeout: FAST_TIMEOUT_MS };

/* ── 10. URL Decode ── */

const urlDecodeManifest: ToolManifest = {
  id: "decode.url",
  name: "URL Decode",
  description: "Decode a URL-encoded (percent-encoded) string",
  category: "encode",
  tags: ["url", "decode", "percent", "uri"],
  params: [{ name: "input", type: "string", required: true, description: "URL-encoded string to decode" }],
  output_type: "text",
  keywords: ["url", "decode", "percent", "uri", "解码", "解转义"],
  patterns: ["url.*decode", "decode.*url"],
};

const urlDecodeHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const input = str(params, "input");
  if (!input) return fail("EMPTY_INPUT", "Input cannot be empty", start);
  try {
    return ok(decodeURIComponent(input), start);
  } catch {
    return fail("INVALID_ENCODING", "Input is not valid URL-encoded string", start);
  }
};

export const urlDecode: ToolRegistryEntry = { manifest: urlDecodeManifest, handler: urlDecodeHandler, timeout: FAST_TIMEOUT_MS };

/* ── 11. JWT Decode ── */

const jwtDecodeManifest: ToolManifest = {
  id: "decode.jwt",
  name: "JWT Decode",
  description: "Decode a JWT token and display its header and payload (no signature verification)",
  category: "encode",
  tags: ["jwt", "decode", "token", "auth"],
  params: [{ name: "input", type: "string", required: true, description: "JWT token string" }],
  output_type: "json",
  keywords: ["jwt", "decode", "token", "bearer", "解码", "令牌"],
  patterns: ["jwt.*decode", "decode.*jwt", "parse.*jwt", "jwt.*token"],
};

const decodeJwtPart = (part: string): unknown => {
  const padded = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
};

const jwtDecodeHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const token = str(params, "input").trim();
  const parts = token.split(".");
  if (parts.length !== 3) return fail("INVALID_JWT", "JWT must have exactly 3 parts separated by dots", start);
  try {
    const header = decodeJwtPart(parts[0]);
    const payload = decodeJwtPart(parts[1]);
    return {
      status: "success",
      output: { json: { header, payload, signature: parts[2] } },
      duration_ms: Date.now() - start,
    };
  } catch {
    return fail("DECODE_ERROR", "Failed to decode JWT — parts are not valid Base64url JSON", start);
  }
};

export const jwtDecode: ToolRegistryEntry = { manifest: jwtDecodeManifest, handler: jwtDecodeHandler, timeout: FAST_TIMEOUT_MS };
