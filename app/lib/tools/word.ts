// @input: DOCX file URL
// @output: Extracted plain text file and metadata
// @position: Word file tool using Python helper script

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ToolHandler, ToolManifest, ToolRegistryEntry } from "@/lib/engine/types";
import { LONG_TIMEOUT_MS } from "@/lib/engine/types";
import { downloadFile, runCommand, sanitizeStderr, tempFile } from "./helpers";

const PYTHON_BIN = process.env.OMNIAGENT_PYTHON?.trim() || "python";
const WORD_TOOL_SCRIPT =
  process.env.OMNIAGENT_WORD_TOOL_SCRIPT?.trim() ||
  resolve(process.cwd(), "scripts", "word_tool.py");

type WordPythonResult = {
  ok: boolean;
  code?: string;
  message?: string;
  data?: {
    char_count?: number;
    line_count?: number;
    paragraph_count?: number;
  };
};

const parsePythonResult = (stdout: string): WordPythonResult | null => {
  const lines = stdout
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(lines[i]) as WordPythonResult;
      if (typeof parsed === "object" && parsed !== null && "ok" in parsed) {
        return parsed;
      }
    } catch {
      // keep scanning until a parseable JSON line appears
    }
  }
  return null;
};

const runWordPython = async (args: string[]): Promise<WordPythonResult> => {
  if (!existsSync(WORD_TOOL_SCRIPT)) {
    return {
      ok: false,
      code: "word_tool_script_missing",
      message: `Word helper script not found: ${WORD_TOOL_SCRIPT}`,
    };
  }

  const result = await runCommand(PYTHON_BIN, [WORD_TOOL_SCRIPT, ...args], LONG_TIMEOUT_MS);
  const parsed = parsePythonResult(result.stdout);
  if (parsed) {
    if (parsed.ok) return parsed;
    return {
      ok: false,
      code: parsed.code || "word_tool_failed",
      message:
        parsed.message ||
        sanitizeStderr(result.stderr) ||
        "Word helper reported failed status",
    };
  }
  return {
    ok: false,
    code: "word_tool_exec_error",
    message:
      sanitizeStderr(result.stderr) ||
      `Word helper exited with code ${result.exitCode}`,
  };
};

const cleanupFiles = (paths: string[]) => {
  for (const filePath of paths) {
    try {
      unlinkSync(filePath);
    } catch {
      // best-effort cleanup
    }
  }
};

const failResult = (code: string, message: string, start: number) => ({
  status: "failed" as const,
  error: { code, message },
  duration_ms: Date.now() - start,
});

const wordExtractTextManifest: ToolManifest = {
  id: "word.extract_text",
  name: "Word Extract Text",
  description: "Extract plain text from DOCX",
  category: "convert",
  tags: ["word", "docx", "extract", "text", "file"],
  params: [
    {
      name: "file_url",
      type: "file",
      required: true,
      description: "DOCX file URL",
      accept: [".docx"],
    },
  ],
  output_type: "file",
  keywords: ["word", "docx", "extract text", "word to txt", "docx parse"],
  patterns: ["word.*text", "docx.*text", "extract.*docx"],
};

const wordExtractTextHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const input = tempFile("docx");
  const output = tempFile("txt");

  try {
    const source = await downloadFile(String(params.file_url ?? ""));
    writeFileSync(input, source);

    const py = await runWordPython([
      "--op",
      "extract_text",
      "--input",
      input,
      "--output",
      output,
    ]);
    if (!py.ok) {
      throw new Error(py.message || py.code || "Word extraction failed");
    }

    if (!existsSync(output)) {
      throw new Error("Word extraction output missing");
    }

    const extractedText = readFileSync(output, "utf8");
    return {
      status: "success" as const,
      output_url: output,
      output: {
        text: extractedText,
        ...(py.data ?? {}),
      },
      duration_ms: Date.now() - start,
    };
  } catch (error) {
    cleanupFiles([input, output]);
    return failResult("word_extract_error", (error as Error).message, start);
  } finally {
    cleanupFiles([input]);
  }
};

export const wordExtractText: ToolRegistryEntry = {
  manifest: wordExtractTextManifest,
  handler: wordExtractTextHandler,
  timeout: LONG_TIMEOUT_MS,
};

