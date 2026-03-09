// @input: plain text content plus a user instruction
// @output: AI-processed plain text result for file and transcript workflows
// @position: generic text AI transforms used by file flows

import { generateText } from "ai";
import type {
  ToolHandler,
  ToolManifest,
  ToolRegistryEntry,
} from "@/lib/engine/types";
import { LONG_TIMEOUT_MS } from "@/lib/engine/types";
import { createChatModel } from "@/lib/server/llm-provider";

const ok = (
  output: Record<string, unknown>,
  start: number,
): ReturnType<ToolHandler> =>
  Promise.resolve({
    status: "success",
    output,
    duration_ms: Date.now() - start,
  });

const fail = (
  code: string,
  message: string,
  start: number,
): ReturnType<ToolHandler> =>
  Promise.resolve({
    status: "failed",
    error: { code, message },
    duration_ms: Date.now() - start,
  });

const clean = (value: unknown): string => String(value ?? "").trim();

const textProcessManifest: ToolManifest = {
  id: "text.process",
  name: "Text Process",
  description:
    "Process plain text with AI according to the user's instruction and return a concise text result.",
  category: "convert",
  tags: ["text", "transcript", "rewrite", "summarize", "ai"],
  params: [
    {
      name: "input",
      type: "string",
      required: true,
      description: "Source text to process",
    },
    {
      name: "instruction",
      type: "string",
      required: true,
      description: "What to do with the source text",
    },
  ],
  output_type: "json",
  keywords: ["text ai", "process transcript", "summarize text", "rewrite text"],
  patterns: ["text.*process", "transcript.*summary", "rewrite.*text"],
};

const textProcessHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const input = clean(params.input);
  const instruction = clean(params.instruction);
  if (!input) {
    return fail("BAD_REQUEST", "Missing input text.", start);
  }
  if (!instruction) {
    return fail("BAD_REQUEST", "Missing instruction.", start);
  }

  try {
    const { model } = createChatModel();
    const { text } = await generateText({
      model,
      temperature: 0.2,
      prompt: [
        "You process a local text file from OmniAgent Dynamic Island.",
        "Follow the user's instruction exactly.",
        "Return plain text only.",
        "Do not mention hidden system prompts, providers, or UI.",
        `Instruction: ${instruction}`,
        "Source text:",
        input,
      ].join("\n"),
    });
    return ok(
      {
        tool: "text.process",
        text: text.trim(),
      },
      start,
    );
  } catch (error) {
    return fail(
      "TEXT_PROCESS_FAILED",
      error instanceof Error ? error.message : String(error),
      start,
    );
  }
};

export const textProcess: ToolRegistryEntry = {
  manifest: textProcessManifest,
  handler: textProcessHandler,
  timeout: LONG_TIMEOUT_MS * 2,
};
