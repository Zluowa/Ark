// @input: Configuration params (length, format, charset)
// @output: Generated strings (UUID, password, timestamp)
// @position: Generator tools — pure TypeScript, crypto-grade randomness

import { randomBytes } from "node:crypto";
import type { ToolManifest, ToolHandler, ToolRegistryEntry } from "@/lib/engine/types";
import { FAST_TIMEOUT_MS } from "@/lib/engine/types";

/* ── Helpers ── */

const ok = (data: Record<string, unknown>, start: number): ReturnType<ToolHandler> =>
  Promise.resolve({ status: "success", output: data, duration_ms: Date.now() - start });

const fail = (code: string, message: string, start: number): ReturnType<ToolHandler> =>
  Promise.resolve({ status: "failed", error: { code, message }, duration_ms: Date.now() - start });

const str = (params: Record<string, unknown>, key: string) => String(params[key] ?? "");
const num = (params: Record<string, unknown>, key: string, def: number) => {
  const v = Number(params[key]);
  return Number.isFinite(v) ? v : def;
};

/* ── 16. UUID v4 ── */

const uuidManifest: ToolManifest = {
  id: "generate.uuid",
  name: "Generate UUID v4",
  description: "Generate a random UUID v4",
  category: "generate",
  tags: ["uuid", "generate", "random", "id"],
  params: [
    { name: "count", type: "number", required: false, default: 1, description: "Number of UUIDs to generate (1-100)", min: 1, max: 100 },
  ],
  output_type: "text",
  keywords: ["uuid", "generate", "random", "id", "生成", "唯一标识"],
  patterns: ["generate.*uuid", "uuid", "random.*id"],
};

const generateUUIDv4 = (): string => {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant bits
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const uuidHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const count = Math.min(100, Math.max(1, num(params, "count", 1)));
  const uuids = Array.from({ length: count }, generateUUIDv4);
  return ok({ text: uuids.join("\n"), uuids }, start);
};

export const generateUuid: ToolRegistryEntry = { manifest: uuidManifest, handler: uuidHandler, timeout: FAST_TIMEOUT_MS };

/* ── 17. Password Generator ── */

const CHARSETS: Record<string, string> = {
  lowercase: "abcdefghijklmnopqrstuvwxyz",
  uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  symbols: "!@#$%^&*()_+-=[]{}|;:,.<>?",
};

const passwordManifest: ToolManifest = {
  id: "generate.password",
  name: "Generate Password",
  description: "Generate a cryptographically random password",
  category: "generate",
  tags: ["password", "generate", "random", "security"],
  params: [
    { name: "length", type: "number", required: false, default: 16, description: "Password length (8-128)", min: 8, max: 128 },
    { name: "include_symbols", type: "boolean", required: false, default: true, description: "Include symbols" },
    { name: "include_digits", type: "boolean", required: false, default: true, description: "Include digits" },
    { name: "include_uppercase", type: "boolean", required: false, default: true, description: "Include uppercase letters" },
  ],
  output_type: "text",
  keywords: ["password", "generate", "random", "security", "生成密码", "随机密码"],
  patterns: ["generate.*password", "random.*password", "password.*generator"],
};

const randomChar = (charset: string): string => {
  const idx = randomBytes(1)[0] % charset.length;
  return charset[idx];
};

const passwordHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const length = Math.min(128, Math.max(8, num(params, "length", 16)));
  let charset = CHARSETS.lowercase;
  if (params.include_uppercase !== false) charset += CHARSETS.uppercase;
  if (params.include_digits !== false) charset += CHARSETS.digits;
  if (params.include_symbols !== false) charset += CHARSETS.symbols;
  const password = Array.from({ length }, () => randomChar(charset)).join("");
  return ok({ text: password }, start);
};

export const generatePassword: ToolRegistryEntry = { manifest: passwordManifest, handler: passwordHandler, timeout: FAST_TIMEOUT_MS };

/* ── 18. Timestamp Generator ── */

const timestampManifest: ToolManifest = {
  id: "generate.timestamp",
  name: "Generate Timestamp",
  description: "Generate current timestamp in multiple formats",
  category: "generate",
  tags: ["timestamp", "generate", "time", "unix", "iso"],
  params: [
    { name: "format", type: "enum", required: false, default: "all", description: "Output format", enum_values: ["all", "unix", "unix_ms", "iso", "rfc2822", "date", "time"] },
  ],
  output_type: "json",
  keywords: ["timestamp", "time", "unix", "iso", "generate", "时间戳", "生成时间"],
  patterns: ["generate.*timestamp", "timestamp", "current.*time", "now.*timestamp"],
};

const timestampHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const now = new Date();
  const format = str(params, "format") || "all";

  const formats: Record<string, string | number> = {
    unix: Math.floor(now.getTime() / 1000),
    unix_ms: now.getTime(),
    iso: now.toISOString(),
    rfc2822: now.toUTCString(),
    date: now.toISOString().split("T")[0],
    time: now.toISOString().split("T")[1].replace("Z", ""),
  };

  if (format === "all") {
    return { status: "success", output: { json: formats, text: JSON.stringify(formats, null, 2) }, duration_ms: Date.now() - start };
  }

  if (!(format in formats)) return fail("INVALID_FORMAT", `Unknown format: ${format}`, start);
  return { status: "success", output: { text: String(formats[format]), value: formats[format] }, duration_ms: Date.now() - start };
};

export const generateTimestamp: ToolRegistryEntry = { manifest: timestampManifest, handler: timestampHandler, timeout: FAST_TIMEOUT_MS };

/* ── 19. QR Code Generator ── */

const qrcodeManifest: ToolManifest = {
  id: "generate.qrcode",
  name: "Generate QR Code",
  description: "Generate a QR code image from text or URL",
  category: "generate",
  tags: ["qrcode", "generate", "barcode", "scan"],
  params: [
    { name: "text", type: "string", required: true, description: "Text or URL to encode" },
    { name: "size", type: "number", required: false, default: 256, description: "Image size in pixels (64-1024)", min: 64, max: 1024 },
  ],
  output_type: "url",
  keywords: ["qr", "qrcode", "barcode", "scan", "二维码", "生成二维码"],
  patterns: ["qr.*code", "generate.*qr", "二维码"],
};

const qrcodeHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const text = str(params, "text");
  if (!text) return fail("EMPTY_TEXT", "Text cannot be empty", start);
  const size = Math.min(1024, Math.max(64, num(params, "size", 256)));
  try {
    const QRCode = await import("qrcode");
    const dataUrl = await QRCode.toDataURL(text, { width: size, margin: 1 });
    return ok({ output_url: dataUrl, text, width: size, height: size }, start);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail("QR_ERROR", `QR code generation failed: ${msg}`, start);
  }
};

export const generateQrcode: ToolRegistryEntry = { manifest: qrcodeManifest, handler: qrcodeHandler, timeout: FAST_TIMEOUT_MS };

/* ── 20. Color Palette Generator ── */

const colorPaletteManifest: ToolManifest = {
  id: "generate.color_palette",
  name: "Generate Color Palette",
  description: "Generate a harmonious color palette from a base color",
  category: "generate",
  tags: ["color", "palette", "design", "generate"],
  params: [
    { name: "base_color", type: "string", required: true, description: "Base color in hex (e.g. #3B82F6)" },
    { name: "count", type: "number", required: false, default: 5, description: "Number of colors (3-10)", min: 3, max: 10 },
  ],
  output_type: "json",
  keywords: ["color", "palette", "generate", "design", "颜色", "调色板", "配色"],
  patterns: ["color.*palette", "palette.*generate", "调色板"],
};

const hexToHsl = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let hue = 0;
  if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) hue = ((b - r) / d + 2) / 6;
  else hue = ((r - g) / d + 4) / 6;
  return [hue * 360, s, l];
};

const hslToHex = (h: number, s: number, l: number): string => {
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  h = ((h % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
  const g = Math.round(hue2rgb(p, q, h) * 255);
  const b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
};

const colorPaletteHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const base = str(params, "base_color").replace(/^#?/, "#");
  if (!/^#[0-9a-fA-F]{6}$/.test(base)) return fail("INVALID_COLOR", "Provide a 6-digit hex color", start);
  const count = Math.min(10, Math.max(3, num(params, "count", 5)));
  const [h, s, l] = hexToHsl(base);
  const colors: string[] = [];
  for (let i = 0; i < count; i++) {
    const hue = (h + (i * 360) / count) % 360;
    const lightness = 0.3 + (i / (count - 1)) * 0.4;
    colors.push(hslToHex(hue, Math.min(s + 0.1, 1), lightness));
  }
  return ok({ json: { base, colors, count }, text: colors.join(", ") }, start);
};

export const generateColorPalette: ToolRegistryEntry = { manifest: colorPaletteManifest, handler: colorPaletteHandler, timeout: FAST_TIMEOUT_MS };
