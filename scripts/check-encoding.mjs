#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, extname } from "node:path";

const textExtensions = new Set([
  ".rs",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".toml",
  ".yaml",
  ".yml",
  ".html",
  ".css",
  ".scss",
  ".sh",
  ".txt",
]);

const textBasenames = new Set([
  ".editorconfig",
  ".gitattributes",
  "AGENTS.md",
  "README",
  "README.md",
]);

const suspiciousPatterns = [
  {
    re: /娌夋蹈寮忚拷闂/u,
    reason: "known mojibake sequence detected",
  },
  {
    re: /姝ｅ湪妫/u,
    reason: "known mojibake sequence detected",
  },
  {
    re: /锟斤拷/u,
    reason: "known mojibake sequence detected",
  },
];

function getGitFileList(stagedOnly) {
  const args = stagedOnly
    ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR"]
    : ["ls-files"];
  const raw = execFileSync("git", args, { encoding: "utf8" });
  return raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
}

function isTextCandidate(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (textExtensions.has(ext)) return true;
  return textBasenames.has(basename(filePath));
}

function hasUtf8Bom(buffer) {
  return (
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
  );
}

function looksBinary(buffer) {
  for (let i = 0; i < buffer.length; i += 1) {
    if (buffer[i] === 0x00) return true;
  }
  return false;
}

function checkFile(path) {
  if (!existsSync(path)) return [];
  const buf = readFileSync(path);
  const errors = [];
  const normalizedPath = path.replace(/\\/g, "/");
  const skipMojibakeHeuristics = normalizedPath.endsWith(
    "scripts/check-encoding.mjs",
  );
  if (looksBinary(buf)) return errors;
  if (hasUtf8Bom(buf)) {
    errors.push("UTF-8 BOM is not allowed");
  }
  let text = "";
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    errors.push("file is not valid UTF-8");
    return errors;
  }
  if (text.includes("\uFFFD")) {
    errors.push("replacement character (U+FFFD) found");
  }
  if (!skipMojibakeHeuristics) {
    for (const pattern of suspiciousPatterns) {
      if (pattern.re.test(text)) {
        errors.push(pattern.reason);
      }
    }
  }
  return errors;
}

function main() {
  const stagedOnly = process.argv.includes("--staged");
  const files = getGitFileList(stagedOnly).filter(isTextCandidate);
  const failed = [];

  for (const file of files) {
    const errors = checkFile(file);
    if (errors.length > 0) {
      failed.push({ file, errors });
    }
  }

  if (failed.length > 0) {
    console.error("Encoding check failed:");
    for (const item of failed) {
      console.error(`- ${item.file}`);
      for (const err of item.errors) {
        console.error(`  - ${err}`);
      }
    }
    process.exit(1);
  }

  console.log(
    `Encoding check passed (${files.length} files${stagedOnly ? ", staged only" : ""}).`,
  );
}

main();
