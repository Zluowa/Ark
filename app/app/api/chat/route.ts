import { randomUUID } from "node:crypto";
import { frontendTools } from "@assistant-ui/react-ai-sdk";
import {
  streamText,
  convertToModelMessages,
  stepCountIs,
  type UIMessage,
} from "ai";
import { runRegistry } from "@/lib/server/run-registry";
import { authorizeRequest } from "@/lib/server/access-control";
import { toResponse } from "@/lib/shared/result";
import { createChatModel } from "@/lib/server/llm-provider";
import { withObservedRequest } from "@/lib/server/observability";
import { executeTool, ToolExecutionError } from "@/lib/server/tool-executor";
import {
  enforceWriteRateLimit,
  parseJsonBodyWithLimit,
  recordAuditEvent,
} from "@/lib/server/security-controls";
import { buildAiTools, buildSystemPrompt } from "@/lib/engine/ai-tools";

type ChatRequestBody = {
  messages: UIMessage[];
  system?: string;
  tools?: Parameters<typeof frontendTools>[0];
  source?: string;
};

const resolveSource = (req: Request, body: ChatRequestBody): string => {
  const fromBody = body.source?.trim();
  if (fromBody) return fromBody;
  const fromHeader =
    req.headers.get("x-omni-source")?.trim() ||
    req.headers.get("x-source")?.trim();
  if (fromHeader) return fromHeader;
  return "chat";
};

const extractLatestUserText = (messages: UIMessage[]): string => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role !== "user") continue;

    const parts = (msg as { parts?: Array<{ text?: string }> }).parts;
    if (Array.isArray(parts)) {
      const joined = parts
        .map((part) => (typeof part.text === "string" ? part.text : ""))
        .join(" ")
        .trim();
      if (joined) return joined;
    }

    const legacyContent = (msg as { content?: unknown }).content;
    if (typeof legacyContent === "string" && legacyContent.trim()) {
      return legacyContent.trim();
    }
    if (Array.isArray(legacyContent)) {
      const joined = legacyContent
        .map((part) => {
          if (typeof part === "string") return part;
          if (!part || typeof part !== "object") return "";
          const maybeText = (part as { text?: unknown }).text;
          if (typeof maybeText === "string") return maybeText;
          return "";
        })
        .join(" ")
        .trim();
      if (joined) return joined;
    }
  }
  return "";
};

type DirectToolIntent = {
  tool: string;
  params: Record<string, unknown>;
  ack?: string;
};

const SUPPORTED_IMAGE_ASPECT_RATIOS = [
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "5:4",
  "4:5",
  "21:9",
  "9:21",
] as const;

const extractAspectRatioFromPrompt = (promptText: string): string | undefined => {
  const normalizedText = promptText
    .replace(/\uFF1A/g, ":")
    .replace(/(\d+)\s*[xX*]\s*(\d+)/g, "$1:$2")
    .replace(/(\d+)\s*\u6BD4\s*(\d+)/g, "$1:$2");

  const explicitMatch = normalizedText.match(
    /\b(1:1|16:9|9:16|4:3|3:4|3:2|2:3|5:4|4:5|21:9|9:21)\b/i,
  );
  if (explicitMatch) {
    const ratio = explicitMatch[1];
    if ((SUPPORTED_IMAGE_ASPECT_RATIOS as readonly string[]).includes(ratio)) {
      return ratio;
    }
  }

  const aliasMatch = normalizedText.match(/\b(square|landscape|portrait)\b/i);
  if (!aliasMatch) return undefined;

  const alias = aliasMatch[1].toLowerCase();
  if (alias === "square") return "1:1";
  if (alias === "landscape") return "16:9";
  if (alias === "portrait") return "9:16";
  return undefined;
};

const tryParseMusicQuery = (raw: string): string | undefined => {
  const normalized = raw.trim().replace(/\u3000/g, " ");
  if (!normalized) return undefined;

  const zhPlay = "\u64ad\u653e";
  const zhSearchSong = "\u641c\u6b4c";
  const zhRequestSong = "\u70b9\u6b4c";
  const zhOneSong = "\u6765\u4e00\u9996";
  const zhListen = "\u542c";

  const clean = (input: string): string => {
    let out = input.trim();
    out = out.replace(/^[\p{P}\p{S}\s]+/gu, "").replace(/[\p{P}\p{S}\s]+$/gu, "");
    out = out.replace(
      /^(?:\u4e00\u4e2a|\u4e00\u9996|\u9996|\u4e2a|\u8bf7|\u5e2e\u6211|\u7ed9\u6211|\u8ba9\u6211)\s*/u,
      "",
    );
    out = out.replace(
      /(?:\u7684\u6b4c|\u6b4c\u66f2|\u6b4c|\u97f3\u4e50|\u542c|\u5427|\u5440|\u5462|please|pls)$/iu,
      "",
    );
    return out.trim();
  };

  for (const prefix of [
    "/music ",
    "music ",
    "song ",
    "play ",
    `${zhPlay} `,
    zhPlay,
    `${zhSearchSong} `,
    zhSearchSong,
    `${zhRequestSong} `,
    zhRequestSong,
    `${zhOneSong} `,
    zhOneSong,
  ]) {
    if (normalized.startsWith(prefix)) {
      const q = clean(normalized.slice(prefix.length));
      if (q.length > 1) return q;
    }
  }

  for (const marker of [zhPlay, zhOneSong, zhRequestSong, zhSearchSong, zhListen, "play "]) {
    const idx = normalized.indexOf(marker);
    if (idx >= 0) {
      const q = clean(normalized.slice(idx + marker.length));
      if (q.length > 1) return q;
    }
  }
  return undefined;
};

const looksLikeImageIntent = (text: string): boolean => {
  const lower = text.toLowerCase();
  if (
    /(?:\u538b\u7f29|\u8f6c\u6362|\u88c1\u526a|crop|compress|convert|resize|metadata|rotate)/i.test(
      lower,
    )
  ) {
    return false;
  }
  const hasChineseImageTarget =
    /(?:\u56fe|\u56fe\u7247|\u56fe\u50cf|\u5934\u50cf|\u58c1\u7eb8)/i.test(lower);
  const hasChineseStyleTransform =
    /(?:\u6539\u6210|\u53d8\u6210|\u6362\u6210|\u98ce\u683c|\u91cd\u7ed8|\u91cd\u753b|\u4e8c\u521b|\u91cd\u65b0\u751f\u6210)/i.test(
      lower,
    );
  return (
    /(?:\u56fe\u751f\u56fe|\u4ee5\u56fe\u751f\u56fe|\u751f\u56fe|\u753b\u4e00\u5f20|\u751f\u6210\u56fe|\u751f\u6210\u56fe\u7247|\u56fe\u7247\u751f\u6210|\u56fe\u50cf\u751f\u6210|\u5934\u50cf|\u58c1\u7eb8|\u6d77\u62a5|\u5c01\u9762|\u63d2\u753b|draw|generate image|image generation|image to image|img2img)/i.test(
      lower,
    ) ||
    (/(\u751f\u6210|\u505a\u4e00\u5f20|\u6765\u4e00\u5f20|\u753b\u4e00\u5f20|\u753b\u4e2a|\u505a\u4e2a)/i.test(
      lower,
    ) &&
      /(\u56fe|\u56fe\u7247|\u56fe\u50cf|\u5934\u50cf|\u58c1\u7eb8|image|poster|icon|logo|photo|avatar)/i.test(
        lower,
      ))
    || (hasChineseImageTarget && hasChineseStyleTransform)
  );
};

const looksLikeWebIntent = (text: string): boolean => {
  const lower = text.toLowerCase();
  return /(?:\u8054\u7f51\u641c\u7d22|\u8054\u7f51\u67e5|\u7f51\u7edc\u641c\u7d22|\u7f51\u4e0a\u641c\u7d22|\u7f51\u9875\u641c\u7d22|\u641c\u7d22\u7f51\u9875|\u67e5\u7f51\u9875|\u4e0a\u7f51\u67e5|web\u641c\u7d22|\u641c\u7d22\u4e00\u4e2a|\u5e2e\u6211\u67e5|\u67e5\u4e00\u4e2a|search web|web search|browse web|look up|news|\u65b0\u95fb)/i.test(
    lower,
  );
};

const normalizeImagePrompt = (text: string): string => {
  const trimmed = text.trim();
  const stripped = trimmed
    .replace(/^(?:\u8bf7|\u5e2e\u6211|\u9ebb\u70e6|\u80fd\u4e0d\u80fd|\u53ef\u4ee5|\u7ed9\u6211)\s*/u, "")
    .replace(
      /^(?:\u56fe\u751f\u56fe|\u4ee5\u56fe\u751f\u56fe|\u751f\u6210|\u505a\u4e00\u5f20|\u6765\u4e00\u5f20|\u753b\u4e00\u5f20|\u753b\u4e2a|\u505a\u4e2a)\s*/u,
      "",
    )
    .trim();
  return stripped.length >= 6 ? stripped : trimmed;
};

const normalizeWebQuery = (text: string): string => {
  const stripped = text
    .trim()
    .replace(/^(?:\u8bf7|\u5e2e\u6211|\u9ebb\u70e6|\u80fd\u4e0d\u80fd|\u53ef\u4ee5|\u7ed9\u6211)\s*/u, "")
    .replace(
      /^(?:\u8054\u7f51\u641c\u7d22|\u8054\u7f51\u67e5|\u7f51\u7edc\u641c\u7d22|\u7f51\u4e0a\u641c\u7d22|\u7f51\u9875\u641c\u7d22|\u641c\u7d22\u7f51\u9875|\u67e5\u7f51\u9875|\u4e0a\u7f51\u67e5|web\u641c\u7d22|\u641c\u7d22\u4e00\u4e2a|\u5e2e\u6211\u67e5|\u67e5\u4e00\u4e2a|search web|web search|browse web|look up)\s*/iu,
      "",
    )
    .trim();
  return stripped || text.trim();
};

const extractReferenceImageUrl = (text: string): string | undefined => {
  const match = text.match(/(https?:\/\/\S+|\/api\/v1\/files\/\S+)/i);
  if (!match) return undefined;
  const raw = match[1].replace(/[),.;!?]+$/g, "").trim();
  if (!raw) return undefined;
  if (raw.startsWith("/api/")) {
    return `http://127.0.0.1:3010${raw}`;
  }
  return raw;
};

const extractMediaUrl = (text: string): string | undefined => {
  const match = text.match(
    /(https?:\/\/\S*(?:bilibili\.com|b23\.tv|douyin\.com|iesdouyin\.com|youtube\.com|youtu\.be|xiaohongshu\.com|xhslink\.com)\S*)/i,
  );
  return match?.[1]?.replace(/[),.;!?]+$/g, "").trim() || undefined;
};

const detectMediaToolIntent = (text: string): DirectToolIntent | undefined => {
  const url = extractMediaUrl(text);
  if (!url) return undefined;
  const lower = text.toLowerCase();

  if (
    /(?:subtitle|caption|srt|\u5b57\u5e55|\u63d0\u53d6\u5b57\u5e55|\u4e0b\u8f7d\u5b57\u5e55)/i.test(
      lower,
    )
  ) {
    return {
      tool: "media.extract_subtitle",
      params: { url },
      ack: "Subtitle extraction started.",
    };
  }

  if (
    /(?:audio|mp3|\u97f3\u9891|\u97f3\u8f68|\u63d0\u53d6\u97f3\u9891|\u4e0b\u8f7d\u97f3\u9891)/i.test(
      lower,
    )
  ) {
    return {
      tool: "media.download_audio",
      params: { url },
      ack: "Audio download started.",
    };
  }

  if (
    /(?:info|metadata|details|\u89c6\u9891\u4fe1\u606f|\u89c6\u9891\u8be6\u60c5|\u67e5\u770b\u4fe1\u606f)/i.test(
      lower,
    )
  ) {
    return {
      tool: "media.video_info",
      params: { url },
      ack: "Video info loaded.",
    };
  }

  return {
    tool: "media.download_video",
    params: { url },
    ack: "Video download started.",
  };
};

const summarizeDirectToolResult = (
  intent: DirectToolIntent,
  output: Record<string, unknown>,
): string => {
  const directText = typeof output.text === "string" ? output.text.trim() : "";
  if (directText) return directText;

  if (intent.tool === "web.search") {
    const answer = typeof output.answer === "string" ? output.answer.trim() : "";
    const results = Array.isArray(output.results) ? output.results : [];
    const top = results
      .slice(0, 3)
      .map((item, index) => {
        if (!item || typeof item !== "object") return "";
        const row = item as { title?: unknown; url?: unknown };
        const title =
          typeof row.title === "string" && row.title.trim()
            ? row.title.trim()
            : "Untitled";
        const url = typeof row.url === "string" ? row.url.trim() : "";
        if (!url) return "";
        return `${index + 1}. ${title} - ${url}`;
      })
      .filter(Boolean);

    const lines: string[] = [];
    if (answer) lines.push(answer);
    if (top.length > 0) lines.push(...top);
    return lines.join("\n") || "Web search completed.";
  }

  if (intent.tool === "net.music_search") {
    const songs = Array.isArray(output.songs) ? output.songs : [];
    if (songs.length > 0) {
      return songs
        .slice(0, 3)
        .map((item) => {
          if (!item || typeof item !== "object") return "";
          const row = item as { name?: unknown; artist?: unknown };
          const name = typeof row.name === "string" ? row.name.trim() : "";
          const artist = typeof row.artist === "string" ? row.artist.trim() : "";
          if (!name && !artist) return "";
          return artist ? `${name} - ${artist}` : name;
        })
        .filter(Boolean)
        .join("\n");
    }
    const query = typeof output.query === "string" ? output.query.trim() : "";
    return query ? `Searching music: ${query}` : "Music search completed.";
  }

  if (intent.tool === "generate.image") {
    const outputFile =
      typeof output.output_file_url === "string" ? output.output_file_url.trim() : "";
    return outputFile ? "Image generated successfully." : "Image generation completed.";
  }

  if (intent.tool === "media.video_info") {
    const title = typeof output.title === "string" ? output.title.trim() : "";
    const duration =
      typeof output.duration_str === "string" ? output.duration_str.trim() : "";
    return [title, duration].filter(Boolean).join(" · ") || "Video info loaded.";
  }

  if (intent.tool === "media.download_video") {
    const title = typeof output.title === "string" ? output.title.trim() : "";
    return title ? `Video ready: ${title}` : "Video download completed.";
  }

  if (intent.tool === "media.download_audio") {
    const title = typeof output.title === "string" ? output.title.trim() : "";
    return title ? `Audio ready: ${title}` : "Audio download completed.";
  }

  return intent.ack?.trim() || "";
};

const detectDirectToolIntent = (text: string): DirectToolIntent | undefined => {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  const musicQuery = tryParseMusicQuery(trimmed);
  if (musicQuery) {
    return {
      tool: "net.music_search",
      params: { query: musicQuery },
      ack: `Searching music: ${musicQuery}`,
    };
  }

  const mediaIntent = detectMediaToolIntent(trimmed);
  if (mediaIntent) {
    return mediaIntent;
  }

  if (looksLikeImageIntent(trimmed)) {
    const prompt = normalizeImagePrompt(trimmed);
    const referenceImageUrl = extractReferenceImageUrl(trimmed);
    const aspectRatio =
      extractAspectRatioFromPrompt(prompt) ?? extractAspectRatioFromPrompt(trimmed);
    const params: Record<string, unknown> = { prompt };
    if (aspectRatio) {
      params.aspect_ratio = aspectRatio;
    }
    if (referenceImageUrl) {
      params.reference_image_url = referenceImageUrl;
    }
    return {
      tool: "generate.image",
      params,
      ack: "",
    };
  }

  if (looksLikeWebIntent(trimmed)) {
    const query = normalizeWebQuery(trimmed);
    return {
      tool: "web.search",
      params: { query, max_results: 5, include_answer: true },
      ack: "Web search completed.",
    };
  }

  return undefined;
};

const makeIslandToolSseResponse = (options: {
  runId: string;
  intent: DirectToolIntent;
  idempotencyKey?: string;
  source: string;
  runTool: () => Promise<{
    toolId: string;
    output: Record<string, unknown>;
    text?: string;
  }>;
  onSuccess: (toolId: string) => Promise<void>;
  onError: (message: string) => Promise<void>;
}): Response => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (payload: Record<string, unknown>): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          return true;
        } catch {
          closed = true;
          return false;
        }
      };
      const closeStream = (): void => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
        }
      };

      send({ type: "start" });
      send({
        type: "tool-input-start",
        toolName: options.intent.tool,
      });
      send({
        type: "tool-input-available",
        toolName: options.intent.tool,
        input: options.intent.params,
      });

      try {
        const result = await options.runTool();
        await options.onSuccess(result.toolId);
        const outputFileUrl =
          typeof result.output.output_file_url === "string"
            ? result.output.output_file_url
            : undefined;
        const previewUrl =
          typeof result.output.preview_url === "string"
            ? result.output.preview_url
            : typeof result.output.thumbnail === "string"
              ? result.output.thumbnail
              : undefined;
        send({
          type: "tool-output-available",
          toolName: result.toolId,
          output: result.output,
          ...(outputFileUrl ? { output_file_url: outputFileUrl } : {}),
          ...(previewUrl ? { preview_url: previewUrl } : {}),
        });
        if (result.text?.trim()) {
          send({
            type: "text-delta",
            delta: result.text,
          });
        }
        send({ type: "finish" });
      } catch (error) {
        if (closed) {
          return;
        }
        const message =
          error instanceof ToolExecutionError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Tool execution failed.";
        await options.onError(message);
        send({
          type: "error",
          toolName: options.intent.tool,
          message,
          errorText: message,
        });
        send({
          type: "text-delta",
          delta: `Tool failed: ${message}`,
        });
        send({ type: "finish" });
      } finally {
        closeStream();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-run-id": options.runId,
      ...(options.idempotencyKey
        ? {
            "x-idempotency-key": options.idempotencyKey,
            "x-idempotency-source": options.source,
          }
        : {}),
    },
  });
};

export async function POST(req: Request) {
  return withObservedRequest(req, {
    route: "/api/chat",
    handler: async (observation) => {
      const access = authorizeRequest(req, "execute:write");
      if (!access.ok) {
        return toResponse(access);
      }
      const identity = access.identity;
      observation.setIdentity(identity);

      const rateLimitResponse = enforceWriteRateLimit(
        identity,
        "/api/chat",
        observation.requestId,
      );
      if (rateLimitResponse) {
        return rateLimitResponse;
      }

      const parsedBody = await parseJsonBodyWithLimit<ChatRequestBody>(req, {
        route: "/api/chat",
        maxBytes: 10 * 1024 * 1024,
      });
      if (!parsedBody.ok) {
        return parsedBody.response;
      }
      const body = parsedBody.value;
      const source = resolveSource(req, body);
      const latestUserText = extractLatestUserText(body.messages);
      const idempotencySource = `${identity.tenantId}:${source}`;
      const idempotencyKey = req.headers.get("idempotency-key")?.trim();
      let requestRunId: string = randomUUID();
      let idempotencyReused = false;

      if (idempotencyKey) {
        const existingRunId = await runRegistry.getRunIdByIdempotency(
          idempotencyKey,
          idempotencySource,
        );
        if (existingRunId) {
          requestRunId = existingRunId;
          idempotencyReused = true;
        } else {
          await runRegistry.setIdempotency(
            idempotencyKey,
            idempotencySource,
            requestRunId,
          );
        }
      }

      if (idempotencyReused) {
        const run = await runRegistry.get(requestRunId);
        recordAuditEvent({
          action: "execution.chat_reused",
          apiKeyId: identity.apiKeyId,
          details: {
            run_id: requestRunId,
            source,
          },
          method: "POST",
          outcome: "allowed",
          requestId: observation.requestId,
          route: "/api/chat",
          tenantId: identity.tenantId,
        });
        return Response.json(
          {
            ok: true,
            reused: true,
            runId: requestRunId,
            run,
          },
          {
            headers: {
              "x-run-id": requestRunId,
              "x-idempotency-reused": "1",
            },
          },
        );
      }

      const abortController = new AbortController();

      await runRegistry.createAccepted(requestRunId, {
        apiKeyId: identity.apiKeyId,
        source,
        tenantId: identity.tenantId,
      });
      await runRegistry.attachAbortController(requestRunId, abortController);
      await runRegistry.markRunning(requestRunId);
      recordAuditEvent({
        action: "execution.chat_started",
        apiKeyId: identity.apiKeyId,
        details: {
          run_id: requestRunId,
          source,
        },
        method: "POST",
        outcome: "allowed",
        requestId: observation.requestId,
        route: "/api/chat",
        tenantId: identity.tenantId,
      });

      if (source === "island") {
        const intent = detectDirectToolIntent(latestUserText);
        if (intent) {
          return makeIslandToolSseResponse({
            runId: requestRunId,
            intent,
            idempotencyKey,
            source,
            runTool: async () => {
              const execution = await executeTool(intent.tool, intent.params, {
                tenantId: identity.tenantId,
              });
              const text = summarizeDirectToolResult(intent, execution.result);
              return {
                toolId: execution.toolId,
                output: execution.result,
                text,
              };
            },
            onSuccess: async (toolId: string) => {
              await runRegistry.markSucceeded(requestRunId);
              recordAuditEvent({
                action: "execution.chat_fast_tool_succeeded",
                apiKeyId: identity.apiKeyId,
                details: {
                  run_id: requestRunId,
                  source,
                  tool: toolId,
                },
                method: "POST",
                outcome: "allowed",
                requestId: observation.requestId,
                route: "/api/chat",
                tenantId: identity.tenantId,
              });
            },
            onError: async (message: string) => {
              await runRegistry.markFailed(requestRunId, message);
              recordAuditEvent({
                action: "execution.chat_fast_tool_failed",
                apiKeyId: identity.apiKeyId,
                details: {
                  error: message,
                  run_id: requestRunId,
                  source,
                  tool: intent.tool,
                },
                method: "POST",
                outcome: "error",
                requestId: observation.requestId,
                route: "/api/chat",
                tenantId: identity.tenantId,
              });
            },
          });
        }
      }

      try {
        const { model, thinking } = createChatModel();
        const result = streamText({
          model,
          messages: await convertToModelMessages(body.messages),
          system: body.system ?? buildSystemPrompt(),
          maxRetries: 0,
          abortSignal: abortController.signal,
          headers: {
            "x-run-id": requestRunId,
          },
          stopWhen: stepCountIs(5),
          tools: {
            ...frontendTools(body.tools ?? {}),
            ...buildAiTools({
              tenantId: identity.tenantId,
              latestUserText,
            }),
          },
          ...(thinking
            ? {
                providerOptions: {
                  anthropic: {
                    thinking: { type: "enabled", budgetTokens: 4096 },
                  },
                },
              }
            : {}),
        });

        return result.toUIMessageStreamResponse({
          sendReasoning: true,
          headers: {
            "x-run-id": requestRunId,
            ...(idempotencyKey
              ? {
                  "x-idempotency-key": idempotencyKey,
                  "x-idempotency-source": source,
                }
              : {}),
          },
          onError: (error) => {
            const message =
              error instanceof Error ? error.message : "Chat stream failed.";
            if (abortController.signal.aborted) {
              return "Request cancelled.";
            }
            recordAuditEvent({
              action: "execution.chat_stream_failed",
              apiKeyId: identity.apiKeyId,
              details: {
                error: message,
                run_id: requestRunId,
              },
              method: "POST",
              outcome: "error",
              requestId: observation.requestId,
              route: "/api/chat",
              tenantId: identity.tenantId,
            });
            void runRegistry.markFailed(requestRunId, message);
            return message;
          },
          onFinish: ({ isAborted }) => {
            if (isAborted) {
              recordAuditEvent({
                action: "execution.chat_cancelled",
                apiKeyId: identity.apiKeyId,
                details: {
                  run_id: requestRunId,
                },
                method: "POST",
                outcome: "allowed",
                requestId: observation.requestId,
                route: "/api/chat",
                tenantId: identity.tenantId,
              });
              void runRegistry.markCancelled(requestRunId);
              return;
            }
            recordAuditEvent({
              action: "execution.chat_succeeded",
              apiKeyId: identity.apiKeyId,
              details: {
                run_id: requestRunId,
              },
              method: "POST",
              outcome: "allowed",
              requestId: observation.requestId,
              route: "/api/chat",
              tenantId: identity.tenantId,
            });
            void runRegistry.markSucceeded(requestRunId);
          },
          messageMetadata: ({ part }) => {
            if (
              part.type === "start" ||
              part.type === "finish" ||
              part.type === "finish-step"
            ) {
              return {
                custom: {
                  runId: requestRunId,
                },
              };
            }
            return undefined;
          },
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Chat route initialization failed.";
        await runRegistry.markFailed(requestRunId, message);
        recordAuditEvent({
          action: "execution.chat_init_failed",
          apiKeyId: identity.apiKeyId,
          details: {
            error: message,
            run_id: requestRunId,
          },
          method: "POST",
          outcome: "error",
          requestId: observation.requestId,
          route: "/api/chat",
          tenantId: identity.tenantId,
        });

        return Response.json(
          {
            error: "chat_route_error",
            message,
          },
          { status: 500 },
        );
      }
    },
  });
}

