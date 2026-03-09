// @input: PDF file URLs and processing params
// @output: ToolRegistryEntry objects for 5 PDF tools
// @position: PDF processing tools using Python (PyMuPDF)

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ToolHandler, ToolManifest, ToolRegistryEntry } from "@/lib/engine/types";
import { LONG_TIMEOUT_MS } from "@/lib/engine/types";
import { downloadFile, runCommand, sanitizeStderr, tempFile } from "./helpers";

const PYTHON_BIN = process.env.OMNIAGENT_PYTHON?.trim() || "python";
const PDF_TOOL_SCRIPT =
  process.env.OMNIAGENT_PDF_TOOL_SCRIPT?.trim() ||
  resolve(process.cwd(), "scripts", "pdf_tool.py");

type PdfPythonResult = {
  ok: boolean;
  code?: string;
  message?: string;
  data?: Record<string, unknown>;
};

const parsePythonResult = (stdout: string): PdfPythonResult | null => {
  const lines = stdout
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(lines[i]) as PdfPythonResult;
      if (typeof parsed === "object" && parsed !== null && "ok" in parsed) {
        return parsed;
      }
    } catch {
      // continue
    }
  }
  return null;
};

const runPdfPython = async (args: string[]): Promise<PdfPythonResult> => {
  if (!existsSync(PDF_TOOL_SCRIPT)) {
    return {
      ok: false,
      code: "pdf_tool_script_missing",
      message: `PDF helper script not found: ${PDF_TOOL_SCRIPT}`,
    };
  }

  const result = await runCommand(
    PYTHON_BIN,
    [PDF_TOOL_SCRIPT, ...args],
    LONG_TIMEOUT_MS,
  );
  const parsed = parsePythonResult(result.stdout);

  if (parsed) {
    if (parsed.ok) return parsed;
    return {
      ok: false,
      code: parsed.code || "pdf_tool_failed",
      message:
        parsed.message ||
        sanitizeStderr(result.stderr) ||
        "PDF helper reported failed status",
    };
  }

  if (result.exitCode === 0) {
    return {
      ok: false,
      code: "pdf_tool_invalid_output",
      message: "PDF helper returned invalid JSON output",
    };
  }

  return {
    ok: false,
    code: "pdf_tool_exec_error",
    message:
      sanitizeStderr(result.stderr) ||
      `PDF helper exited with code ${result.exitCode}`,
  };
};

const cleanupFiles = (paths: string[]) => {
  for (const path of paths) {
    try {
      unlinkSync(path);
    } catch {
      // best-effort
    }
  }
};

const ensureOutputExists = (output: string): string | undefined => {
  if (existsSync(output)) return output;
  return undefined;
};

const parseRange = (ranges: string): { from: number; to: number } => {
  const [fromStr, toStr] = ranges.split("-");
  const from = Math.max(1, Number.parseInt(fromStr || "1", 10));
  const to = Math.max(from, Number.parseInt(toStr || String(from), 10));
  return { from, to };
};

const mergeFileUrls = (value: unknown): string[] =>
  String(value ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);

const failResult = (code: string, message: string, start: number) => ({
  status: "failed" as const,
  error: { code, message },
  duration_ms: Date.now() - start,
});

/* pdf.compress */

const pdfCompressManifest: ToolManifest = {
  id: "pdf.compress",
  name: "PDF Compress",
  description: "Compress PDF file to reduce file size",
  category: "pdf",
  tags: ["pdf", "compress", "reduce", "size"],
  params: [
    {
      name: "file_url",
      type: "file",
      required: true,
      description: "PDF file URL",
      accept: [".pdf"],
    },
    {
      name: "quality",
      type: "number",
      required: false,
      default: 75,
      description: "Quality 1-100 (lower = smaller)",
      min: 1,
      max: 100,
    },
  ],
  output_type: "file",
  keywords: ["compress", "pdf", "reduce", "size", "smaller", "yasuo", "pdf compress"],
  patterns: ["compress.*pdf", "pdf.*compress", "reduce.*pdf.*size"],
};

const pdfCompressHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const quality = Math.max(1, Math.min(100, Number(params.quality ?? 75)));
  const input = tempFile("pdf");
  const output = tempFile("pdf");

  try {
    const source = await downloadFile(params.file_url as string);
    writeFileSync(input, source);

    const py = await runPdfPython([
      "--op",
      "compress",
      "--input",
      input,
      "--output",
      output,
      "--quality",
      String(quality),
    ]);
    if (!py.ok) {
      throw new Error(py.message || py.code || "PDF compress failed");
    }

    const outputPath = ensureOutputExists(output);
    if (!outputPath) {
      throw new Error("PDF compress output missing");
    }

    const originalSize = source.length;
    const compressedSize = readFileSync(outputPath).length;
    const ratio =
      originalSize > 0
        ? `${Math.round((1 - compressedSize / originalSize) * 100)}%`
        : "0%";

    return {
      status: "success" as const,
      output_url: outputPath,
      output: {
        original_size: originalSize,
        compressed_size: compressedSize,
        ratio,
        ...(py.data ?? {}),
      },
      duration_ms: Date.now() - start,
    };
  } catch (err) {
    cleanupFiles([input, output]);
    return failResult("pdf_compress_error", (err as Error).message, start);
  } finally {
    cleanupFiles([input]);
  }
};

export const pdfCompress: ToolRegistryEntry = {
  manifest: pdfCompressManifest,
  handler: pdfCompressHandler,
  timeout: LONG_TIMEOUT_MS,
};

/* pdf.merge */

const pdfMergeManifest: ToolManifest = {
  id: "pdf.merge",
  name: "PDF Merge",
  description: "Merge multiple PDF files into one",
  category: "pdf",
  tags: ["pdf", "merge", "combine", "join"],
  params: [
    {
      name: "file_urls",
      type: "string",
      required: true,
      description: "Comma-separated PDF file URLs",
    },
  ],
  output_type: "file",
  keywords: ["merge", "combine", "join", "pdf"],
  patterns: ["merge.*pdf", "pdf.*merge", "combine.*pdf"],
};

const pdfMergeHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const urls = mergeFileUrls(params.file_urls);

  if (urls.length < 2) {
    return failResult("bad_request", "Need at least 2 PDF URLs", start);
  }

  const inputs: string[] = [];
  const output = tempFile("pdf");

  try {
    for (const url of urls) {
      const filePath = tempFile("pdf");
      writeFileSync(filePath, await downloadFile(url));
      inputs.push(filePath);
    }

    const py = await runPdfPython([
      "--op",
      "merge",
      "--inputs-json",
      JSON.stringify(inputs),
      "--output",
      output,
    ]);

    if (!py.ok) {
      throw new Error(py.message || py.code || "PDF merge failed");
    }

    const outputPath = ensureOutputExists(output);
    if (!outputPath) {
      throw new Error("PDF merge output missing");
    }

    return {
      status: "success" as const,
      output_url: outputPath,
      output: {
        merged_count: urls.length,
        ...(py.data ?? {}),
      },
      duration_ms: Date.now() - start,
    };
  } catch (err) {
    cleanupFiles([output]);
    return failResult("pdf_merge_error", (err as Error).message, start);
  } finally {
    cleanupFiles(inputs);
  }
};

export const pdfMerge: ToolRegistryEntry = {
  manifest: pdfMergeManifest,
  handler: pdfMergeHandler,
  timeout: LONG_TIMEOUT_MS,
};

/* pdf.split */

const pdfSplitManifest: ToolManifest = {
  id: "pdf.split",
  name: "PDF Split",
  description: "Split PDF by page range (e.g. '1-3')",
  category: "pdf",
  tags: ["pdf", "split", "pages", "extract"],
  params: [
    {
      name: "file_url",
      type: "file",
      required: true,
      description: "PDF file URL",
      accept: [".pdf"],
    },
    {
      name: "ranges",
      type: "string",
      required: true,
      description: "Page range e.g. '1-3' or '2-5'",
    },
  ],
  output_type: "file",
  keywords: ["split", "pdf", "pages", "extract"],
  patterns: ["split.*pdf", "pdf.*split", "extract.*pages"],
};

const pdfSplitHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const { from, to } = parseRange(String(params.ranges ?? ""));

  const input = tempFile("pdf");
  const output = tempFile("pdf");

  try {
    writeFileSync(input, await downloadFile(params.file_url as string));

    const py = await runPdfPython([
      "--op",
      "split",
      "--input",
      input,
      "--output",
      output,
      "--from-page",
      String(from),
      "--to-page",
      String(to),
    ]);

    if (!py.ok) {
      throw new Error(py.message || py.code || "PDF split failed");
    }

    const outputPath = ensureOutputExists(output);
    if (!outputPath) {
      throw new Error("PDF split output missing");
    }

    return {
      status: "success" as const,
      output_url: outputPath,
      output: {
        from_page: from,
        to_page: to,
        ...(py.data ?? {}),
      },
      duration_ms: Date.now() - start,
    };
  } catch (err) {
    cleanupFiles([output]);
    return failResult("pdf_split_error", (err as Error).message, start);
  } finally {
    cleanupFiles([input]);
  }
};

export const pdfSplit: ToolRegistryEntry = {
  manifest: pdfSplitManifest,
  handler: pdfSplitHandler,
  timeout: LONG_TIMEOUT_MS,
};

/* pdf.to_image */

const pdfToImageManifest: ToolManifest = {
  id: "pdf.to_image",
  name: "PDF to Image",
  description: "Convert PDF page to PNG image",
  category: "pdf",
  tags: ["pdf", "image", "png", "convert"],
  params: [
    {
      name: "file_url",
      type: "file",
      required: true,
      description: "PDF file URL",
      accept: [".pdf"],
    },
    {
      name: "page",
      type: "number",
      required: false,
      default: 1,
      description: "Page number",
      min: 1,
      max: 9999,
    },
    {
      name: "dpi",
      type: "number",
      required: false,
      default: 150,
      description: "Output DPI",
      min: 72,
      max: 600,
    },
  ],
  output_type: "file",
  keywords: ["pdf", "image", "png", "convert"],
  patterns: ["pdf.*to.*image", "pdf.*png"],
};

const pdfToImageHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const page = Math.max(1, Number(params.page ?? 1));
  const dpi = Math.max(72, Math.min(600, Number(params.dpi ?? 150)));

  const input = tempFile("pdf");
  const output = tempFile("png");

  try {
    writeFileSync(input, await downloadFile(params.file_url as string));

    const py = await runPdfPython([
      "--op",
      "to_image",
      "--input",
      input,
      "--output",
      output,
      "--page",
      String(page),
      "--dpi",
      String(dpi),
    ]);

    if (!py.ok) {
      throw new Error(py.message || py.code || "PDF to image failed");
    }

    const outputPath = ensureOutputExists(output);
    if (!outputPath) {
      throw new Error("PDF to image output missing");
    }

    return {
      status: "success" as const,
      output_url: outputPath,
      output: {
        page,
        dpi,
        ...(py.data ?? {}),
      },
      duration_ms: Date.now() - start,
    };
  } catch (err) {
    cleanupFiles([output]);
    return failResult("pdf_to_image_error", (err as Error).message, start);
  } finally {
    cleanupFiles([input]);
  }
};

export const pdfToImage: ToolRegistryEntry = {
  manifest: pdfToImageManifest,
  handler: pdfToImageHandler,
  timeout: LONG_TIMEOUT_MS,
};

/* pdf.page_count */

const pdfPageCountManifest: ToolManifest = {
  id: "pdf.page_count",
  name: "PDF Page Count",
  description: "Get the number of pages in a PDF file",
  category: "pdf",
  tags: ["pdf", "pages", "count", "info"],
  params: [
    {
      name: "file_url",
      type: "file",
      required: true,
      description: "PDF file URL",
      accept: [".pdf"],
    },
  ],
  output_type: "json",
  keywords: ["page", "count", "pdf", "pages", "how many"],
  patterns: ["page.*count.*pdf", "pdf.*pages", "how.*many.*pages"],
};

const pdfPageCountHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const input = tempFile("pdf");

  try {
    writeFileSync(input, await downloadFile(params.file_url as string));

    const py = await runPdfPython(["--op", "page_count", "--input", input]);

    if (!py.ok) {
      throw new Error(py.message || py.code || "PDF page count failed");
    }

    return {
      status: "success" as const,
      output: {
        ...(py.data ?? {}),
      },
      duration_ms: Date.now() - start,
    };
  } catch (err) {
    return failResult("pdf_page_count_error", (err as Error).message, start);
  } finally {
    cleanupFiles([input]);
  }
};

export const pdfPageCount: ToolRegistryEntry = {
  manifest: pdfPageCountManifest,
  handler: pdfPageCountHandler,
  timeout: LONG_TIMEOUT_MS,
};
