// @input: one or more file URLs
// @output: zip archive containing the source files
// @position: generic file compression/archive tool

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { tmpdir } from "node:os";
import type { ToolHandler, ToolManifest, ToolRegistryEntry } from "@/lib/engine/types";
import { LONG_TIMEOUT_MS } from "@/lib/engine/types";
import { downloadFile, runCommand } from "./helpers";

const ZIP_CMD = process.platform === "win32" ? "powershell" : "";

const normalizeUrlList = (params: Record<string, unknown>): string[] => {
  const values = [params.file_urls, params.file_url];
  const out: string[] = [];
  for (const value of values) {
    if (!value) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.trim()) out.push(item.trim());
      }
      continue;
    }
    if (typeof value === "string") {
      out.push(
        ...value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      );
    }
  }
  return [...new Set(out)];
};

const normalizeNameList = (params: Record<string, unknown>): string[] => {
  const value = params.filenames;
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const safeNameFromUrl = (url: string, index: number): string => {
  try {
    const parsed = new URL(url, "http://127.0.0.1");
    const raw = basename(parsed.pathname || "");
    if (raw && raw !== "/") return raw;
  } catch {
    // ignore
  }
  return `file-${index + 1}.bin`;
};

const normalizeArchiveEntryName = (name: string, used: Set<string>): string => {
  const clean = name.replace(/[<>:"/\\|?*\x00-\x1f]+/g, "-").trim() || "file.bin";
  if (!used.has(clean)) {
    used.add(clean);
    return clean;
  }
  const stem = basename(clean, extname(clean));
  const ext = extname(clean);
  let index = 2;
  while (used.has(`${stem}-${index}${ext}`)) index += 1;
  const unique = `${stem}-${index}${ext}`;
  used.add(unique);
  return unique;
};

const buildArchiveName = (names: string[]): string => {
  if (names.length === 1) {
    const stem = basename(names[0], extname(names[0])) || "archive";
    return `${stem}.zip`;
  }
  return `archive-${randomUUID().slice(0, 8)}.zip`;
};

const fileCompressManifest: ToolManifest = {
  id: "file.compress",
  name: "File Compress",
  description: "Compress one or more files into a ZIP archive",
  category: "convert",
  tags: ["file", "compress", "archive", "zip", "bundle"],
  params: [
    {
      name: "file_urls",
      type: "file",
      required: false,
      description: "One or more file URLs to archive",
    },
    {
      name: "file_url",
      type: "file",
      required: false,
      description: "Single file URL to archive",
    },
  ],
  output_type: "file",
  keywords: [
    "compress file",
    "zip file",
    "archive files",
    "bundle files",
    "压缩文件",
    "打包文件",
    "文件打包",
    "文件压缩",
  ],
  patterns: [
    "compress.*file",
    "zip.*file",
    "archive.*file",
    "压缩.*文件",
    "打包.*文件",
  ],
};

const fileCompressHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const urls = normalizeUrlList(params);
  const preferredNames = normalizeNameList(params);
  if (urls.length === 0) {
    return {
      status: "failed" as const,
      error: { code: "missing_file", message: "At least one file URL is required." },
      duration_ms: Date.now() - start,
    };
  }
  if (process.platform !== "win32" || !ZIP_CMD) {
    return {
      status: "failed" as const,
      error: {
        code: "unsupported_platform",
        message: "File compression is configured for Windows in this workspace.",
      },
      duration_ms: Date.now() - start,
    };
  }

  const stageDir = join(tmpdir(), `omni-file-archive-${randomUUID()}`);
  const zipPath = join(tmpdir(), `omni-${randomUUID()}.zip`);
  const names: string[] = [];
  const usedNames = new Set<string>();
  let originalSize = 0;

  try {
    mkdirSync(stageDir, { recursive: true });

    for (const [index, url] of urls.entries()) {
      const buffer = await downloadFile(url);
      originalSize += buffer.length;
      const preferredName = preferredNames[index];
      const entryName = normalizeArchiveEntryName(
        preferredName || safeNameFromUrl(url, index),
        usedNames,
      );
      writeFileSync(join(stageDir, entryName), buffer);
      names.push(entryName);
    }

    const command = `Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${zipPath}' -Force`;
    const result = await runCommand(
      ZIP_CMD,
      ["-NoProfile", "-Command", command],
      LONG_TIMEOUT_MS,
    );
    if (result.exitCode !== 0 || !existsSync(zipPath)) {
      throw new Error(result.stderr || "Archive creation failed.");
    }

    const compressedSize = statSync(zipPath).size;
    const compressionRatio =
      originalSize > 0 ? Math.max(0, 1 - compressedSize / originalSize) : 0;

    return {
      status: "success" as const,
      output_url: zipPath,
      output: {
        filename: buildArchiveName(names),
        format: "zip",
        count: names.length,
        output_files: names,
        original_size: originalSize,
        compressed_size: compressedSize,
        compression_ratio: compressionRatio,
        detail_text: `${names.length} file${names.length === 1 ? "" : "s"} | ZIP archive`,
      },
      duration_ms: Date.now() - start,
    };
  } catch (error) {
    try {
      if (existsSync(zipPath)) unlinkSync(zipPath);
    } catch {
      // best effort
    }
    return {
      status: "failed" as const,
      error: { code: "file_compress_failed", message: (error as Error).message },
      duration_ms: Date.now() - start,
    };
  } finally {
    try {
      rmSync(stageDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
};

export const fileCompress: ToolRegistryEntry = {
  manifest: fileCompressManifest,
  handler: fileCompressHandler,
  timeout: LONG_TIMEOUT_MS,
};
