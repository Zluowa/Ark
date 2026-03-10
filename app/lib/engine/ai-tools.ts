// @input: v5 engine tool registry (manifests + handlers)
// @output: Vercel AI SDK tool definitions for LLM function calling
// @position: Bridge layer between v5 engine and AI SDK chat endpoint

import { tool, jsonSchema, type ToolSet } from "ai";
import { initEngine } from "./init";
import { execute } from "./runner";
import { toolRegistry } from "./registry";
import type { ToolParam } from "./types";

type JsonSchemaProperty = {
  type: string;
  description?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
};

const paramToJsonSchema = (param: ToolParam): JsonSchemaProperty => {
  const prop: JsonSchemaProperty = { type: "string", description: param.description };
  switch (param.type) {
    case "number":
      prop.type = "number";
      if (param.min !== undefined) prop.minimum = param.min;
      if (param.max !== undefined) prop.maximum = param.max;
      break;
    case "boolean":
      prop.type = "boolean";
      break;
    case "enum":
      if (param.enum_values?.length) prop.enum = param.enum_values;
      break;
    case "file":
      prop.description = `URL of file: ${param.description}`;
      break;
  }
  return prop;
};

const buildJsonSchema = (params: ToolParam[]) => {
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];
  for (const p of params) {
    properties[p.name] = paramToJsonSchema(p);
    if (p.required) required.push(p.name);
  }
  return jsonSchema<Record<string, unknown>>({
    type: "object" as const,
    properties,
    required,
  });
};

// API tool names must match ^[a-zA-Z0-9_-]{1,128}$ 鈥?dots are not allowed.
const toApiName = (id: string): string => id.replace(/\./g, "_");

type AiToolContext = {
  tenantId?: string;
  latestUserText?: string;
};

const executeHandler = (toolId: string, context?: AiToolContext) => {
  return async (params: Record<string, unknown>) => {
    const normalizedParams = { ...params };
    if (toolId === "net.music_search") {
      const query = resolveMusicQuery(params, context?.latestUserText ?? "");
      if (query) {
        normalizedParams.query = query;
      }
    }

    const result = await execute(toolId, normalizedParams, undefined, context);
    if (result.status === "failed") {
      return { error: result.error?.message ?? "Tool execution failed" };
    }
    const payload: Record<string, unknown> = { ...(result.output ?? {}) };
    if (result.output_url) {
      if (result.output_url.startsWith("http")) {
        payload.output_file_url = result.output_url;
      } else {
        const { register } = await import("@/lib/server/local-file-store");
        payload.output_file_url = register(result.output_url);
      }
    }
    return payload;
  };
};

export const buildSystemPrompt = (): string => {
  initEngine();
  const groups = new Map<string, string[]>();
  for (const m of toolRegistry.list()) {
    const [category] = m.id.split(".");
    const list = groups.get(category) ?? [];
    list.push(`${m.name} (${toApiName(m.id)})`);
    groups.set(category, list);
  }
  const toolList = [...groups.entries()]
    .map(([cat, names]) => `  ${cat}: ${names.join(", ")}`)
    .join("\n");

  return [
    "You are OmniAgent, a helpful file-processing and utility assistant.",
    "You have access to the following tools:\n" + toolList,
    "",
    "Rules:",
    "- When a user asks you to perform a task, call the appropriate tool.",
    "- If no matching tool exists, say so honestly. Never hallucinate capabilities.",
    "- For file-based tools, the user uploads a file and you receive its URL in the message.",
    "- Respond concisely. After a tool call, summarize the result.",
    "- Use the user's language (Chinese if they write Chinese, English if English).",
  ].join("\n");
};

const resolveMusicQuery = (
  params: Record<string, unknown>,
  fallbackText: string,
): string => {
  const tryKeys = ["query", "q", "keyword", "song", "name", "artist", "text"];
  for (const key of tryKeys) {
    const value = params[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return extractMusicQueryFromText(fallbackText);
};

const extractMusicQueryFromText = (raw: string): string => {
  const normalized = raw.trim().replace(/\u3000/g, " ");
  if (!normalized) return "";

  const clean = (input: string): string => {
    let out = input.trim();
    out = out.replace(/^[,.;:!?，。！？；：、（）【】《》“”‘’\s]+/g, "");
    out = out.replace(/[,.;:!?，。！？；：、（）【】《》“”‘’\s]+$/g, "");
    out = out.replace(/^(一个|一首|首|个|请|帮我|给我|让我)\s*/u, "");
    out = out.replace(/(的歌|歌曲|音乐|听|吧|呀|呢|please|pls)$/iu, "");
    return out.trim();
  };

  const prefixes = [
    "/music ",
    "music ",
    "song ",
    "play ",
    "播放 ",
    "播放",
    "搜歌 ",
    "搜歌",
    "点歌 ",
    "点歌",
    "来一首 ",
    "来一首",
  ];
  for (const prefix of prefixes) {
    if (normalized.startsWith(prefix)) {
      const q = clean(normalized.slice(prefix.length));
      if (q.length > 1) return q;
    }
  }

  const markers = ["播放", "来一首", "点歌", "搜歌", "听", "play "];
  for (const marker of markers) {
    const idx = normalized.indexOf(marker);
    if (idx >= 0) {
      const q = clean(normalized.slice(idx + marker.length));
      if (q.length > 1) return q;
    }
  }
  return "";
};
export const buildAiTools = (context?: AiToolContext): ToolSet => {
  initEngine();
  const tools: ToolSet = {};

  for (const manifest of toolRegistry.list()) {
    tools[toApiName(manifest.id)] = tool({
      description: `${manifest.name}: ${manifest.description}`,
      inputSchema: buildJsonSchema(manifest.params),
      execute: executeHandler(manifest.id, context),
    });
  }

  return tools;
};

