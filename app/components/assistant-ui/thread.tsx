import {
  ComposerAddAttachment,
  ComposerAttachments,
  UserMessageAttachments,
} from "@/components/assistant-ui/attachment";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { Reasoning, ReasoningGroup } from "@/components/assistant-ui/reasoning";
import { RunStatusPanel } from "@/components/assistant-ui/run-status-panel";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { toolWidgets } from "@/components/a2ui/registry";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Button } from "@/components/ui/button";
import {
  dispatchPrompt,
  type DispatchAsyncExecution,
  type DispatchFastResponse,
  type DispatchSyncExecutionFailure,
  type DispatchSyncExecutionSuccess,
} from "@/lib/api/control-plane";
import { uploadToolInputFiles } from "@/lib/api/tooling";
import { cn } from "@/lib/utils";
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AuiIf,
  useComposer,
  useComposerRuntime,
  useMessage,
  useThread,
  useThreadRuntime,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  SuggestionPrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  SquareIcon,
} from "lucide-react";
import { type FC, useState } from "react";

export const Thread: FC = () => {
  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root @container flex h-full flex-col bg-[radial-gradient(circle_at_top,rgba(120,197,249,0.12),transparent_28%),linear-gradient(180deg,rgba(5,10,14,0.98),rgba(9,14,20,0.98))]"
      style={{
        ["--thread-max-width" as string]: "44rem",
      }}
    >
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        className="aui-thread-viewport relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth px-4 pt-6"
      >
        <AuiIf condition={(s) => s.thread.isEmpty}>
          <ThreadWelcome />
        </AuiIf>

        <ThreadPrimitive.Messages
          components={{
            UserMessage,
            EditComposer,
            AssistantMessage,
          }}
        />

        <ThreadPrimitive.ViewportFooter className="aui-thread-viewport-footer sticky bottom-0 mx-auto mt-auto flex w-full max-w-(--thread-max-width) flex-col gap-4 overflow-visible rounded-t-[32px] bg-[linear-gradient(180deg,rgba(6,10,14,0),rgba(6,10,14,0.82)_26%,rgba(6,10,14,0.96))] pb-4 backdrop-blur-xl md:pb-6">
          <ThreadScrollToBottom />
          <RunStatusPanel />
          <Composer />
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        className="aui-thread-scroll-to-bottom absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible dark:bg-background dark:hover:bg-accent"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

const ThreadWelcome: FC = () => {
  return (
    <div className="aui-thread-welcome-root mx-auto my-auto flex w-full max-w-(--thread-max-width) grow flex-col">
      <div className="aui-thread-welcome-center flex w-full grow flex-col items-center justify-center">
        <div className="aui-thread-welcome-message flex size-full flex-col justify-center px-4">
          <h1 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both font-semibold text-2xl duration-200">
            Build with control, not guesswork.
          </h1>
          <p className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-muted-foreground text-xl delay-75 duration-200">
            Ask OmniAgent to run a task, then track it through the run
            lifecycle.
          </p>
        </div>
      </div>
      <ThreadSuggestions />
    </div>
  );
};

const ThreadSuggestions: FC = () => {
  return (
    <div className="aui-thread-welcome-suggestions grid w-full @md:grid-cols-2 gap-2 pb-4">
      <ThreadPrimitive.Suggestions
        components={{
          Suggestion: ThreadSuggestionItem,
        }}
      />
    </div>
  );
};

const ThreadSuggestionItem: FC = () => {
  return (
    <div className="aui-thread-welcome-suggestion-display fade-in slide-in-from-bottom-2 @md:nth-[n+3]:block nth-[n+3]:hidden animate-in fill-mode-both duration-200">
      <SuggestionPrimitive.Trigger send asChild>
        <Button
          variant="ghost"
          className="aui-thread-welcome-suggestion h-auto w-full @md:flex-col flex-wrap items-start justify-start gap-1 rounded-2xl border px-4 py-3 text-left text-sm transition-colors hover:bg-muted"
        >
          <span className="aui-thread-welcome-suggestion-text-1 font-medium">
            <SuggestionPrimitive.Title />
          </span>
          <span className="aui-thread-welcome-suggestion-text-2 text-muted-foreground">
            <SuggestionPrimitive.Description />
          </span>
        </Button>
      </SuggestionPrimitive.Trigger>
    </div>
  );
};

type OutputLink = {
  label: string;
  url: string;
};

type ComposerAttachmentValue = {
  type?: string;
  file?: File;
  content?: Array<{
    type?: string;
    image?: string;
  }>;
};

const TOOL_INTENT_HINTS = [
  "compress",
  "convert",
  "merge",
  "split",
  "crop",
  "extract",
  "transcode",
  "format",
  "trim",
] as const;

const IMAGE_ATTACHMENT_TOOL_RULES = [
  {
    toolId: "image.remove_background",
    terms: [
      "remove background",
      "background remove",
      "background cutout",
      "cut out",
      "cutout",
      "抠图",
      "去背景",
      "去背",
      "扣背景",
      "扣除背景",
      "抠出主体",
    ],
  },
  {
    toolId: "image.remove_watermark",
    terms: [
      "remove watermark",
      "watermark removal",
      "watermark cleanup",
      "去水印",
      "去除水印",
      "清除水印",
      "水印清理",
    ],
  },
] as const;

const isLikelyToolIntent = (prompt: string): boolean => {
  const normalized = prompt.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized.length > 280) {
    return false;
  }
  const lineCount = normalized.split(/\r?\n/).length;
  if (lineCount > 3) {
    return false;
  }
  if (
    TOOL_INTENT_HINTS.some((hint) => normalized.includes(hint)) ||
    /(pdf|image|video|audio|json|file)/i.test(normalized)
  ) {
    return true;
  }
  return false;
};

const resolveAttachmentImageTool = (prompt: string): string | undefined => {
  const normalized = prompt.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  const matched = IMAGE_ATTACHMENT_TOOL_RULES.find((rule) =>
    rule.terms.some((term) => normalized.includes(term)),
  );
  return matched?.toolId;
};

const resolveAttachmentDispatchMode = (
  toolId: string | undefined,
): "sync" | "async" => {
  if (toolId === "image.remove_watermark") {
    return "async";
  }
  return "sync";
};

const getFirstComposerImageFile = (
  attachments: readonly ComposerAttachmentValue[],
): File | undefined => {
  for (const attachment of attachments) {
    if (attachment?.type !== "image") {
      continue;
    }
    if (attachment.file instanceof File) {
      return attachment.file;
    }
  }
  return undefined;
};

const toAbsoluteAttachmentUrl = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("/") && typeof window !== "undefined") {
    return `${window.location.origin}${trimmed}`;
  }
  return trimmed;
};

const uploadComposerImageAttachment = async (file: File): Promise<string> => {
  const uploaded = await uploadToolInputFiles([file], "agent_fast_dispatch_image");
  const first = uploaded[0];
  const candidate =
    typeof first?.executor_url === "string" && first.executor_url.trim()
      ? first.executor_url.trim()
      : typeof first?.url === "string" && first.url.trim()
        ? first.url.trim()
        : "";

  if (!candidate) {
    throw new Error("Attached image upload did not return a usable file URL.");
  }

  return toAbsoluteAttachmentUrl(candidate);
};

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isHttpUrl = (value: string): boolean => {
  return /^https?:\/\/\S+$/i.test(value.trim());
};

const collectOutputLinks = (result: Record<string, unknown>): OutputLink[] => {
  const links: OutputLink[] = [];
  const seen = new Set<string>();
  const push = (label: string, raw: unknown) => {
    if (typeof raw !== "string") return;
    const url = raw.trim();
    if (!url || !isHttpUrl(url) || seen.has(url)) return;
    seen.add(url);
    links.push({ label, url });
  };

  push("Output file", result.output_file_url);
  push("Output archive", result.output_archive_url);

  for (const [key, raw] of Object.entries(result)) {
    if (
      (key.endsWith("_url") || key.endsWith("Url")) &&
      key !== "output_file_url" &&
      key !== "output_archive_url"
    ) {
      push(key, raw);
    }
  }
  return links;
};

const isAsyncDispatchExecution = (
  execution: DispatchFastResponse["execution"],
): execution is DispatchAsyncExecution => {
  return (
    isObject(execution) &&
    "job_id" in execution &&
    typeof execution.job_id === "string" &&
    "run_id" in execution &&
    typeof execution.run_id === "string"
  );
};

const isDispatchFailure = (
  execution: DispatchFastResponse["execution"],
): execution is DispatchSyncExecutionFailure => {
  return (
    isObject(execution) &&
    execution.status === "failed" &&
    typeof execution.run_id === "string"
  );
};

const isDispatchSuccess = (
  execution: DispatchFastResponse["execution"],
): execution is DispatchSyncExecutionSuccess => {
  return (
    isObject(execution) &&
    execution.status === "success" &&
    typeof execution.run_id === "string" &&
    isObject(execution.result)
  );
};

const extractDispatchRunId = (
  execution: DispatchFastResponse["execution"],
): string | undefined => {
  if (!isObject(execution)) {
    return undefined;
  }
  const runId = execution.run_id;
  return typeof runId === "string" && runId.trim() ? runId.trim() : undefined;
};

const buildDispatchAssistantText = (response: DispatchFastResponse): string => {
  const tool = response.match.tool ?? "selected tool";
  const execution = response.execution;

  if (isAsyncDispatchExecution(execution)) {
    return [
      `Fast-dispatch accepted for **${tool}**.`,
      `Run ID: \`${execution.run_id}\``,
      `Job ID: \`${execution.job_id}\``,
      "",
      "You can track live progress in the Run Status panel below.",
    ].join("\n");
  }

  if (isDispatchFailure(execution)) {
    const errorCode = execution.error?.code ?? "execution_error";
    const errorMessage = execution.error?.message ?? "Tool execution failed.";
    return [
      `Fast-dispatch failed for **${tool}**.`,
      `Run ID: \`${execution.run_id}\``,
      "",
      `Error: \`${errorCode}\` - ${errorMessage}`,
      "",
      "Try one of these:",
      "1. Retry with clearer input or smaller files.",
      "2. Open **Tools** to edit parameters before rerun.",
    ].join("\n");
  }

  if (!isDispatchSuccess(execution)) {
    return `Fast-dispatch completed for **${tool}**.`;
  }

  const lines: string[] = [
    `Fast-dispatch completed with **${tool}**.`,
    `Run ID: \`${execution.run_id}\``,
  ];
  if (typeof execution.duration_ms === "number") {
    lines.push(
      `Duration: ${Math.max(1, Math.floor(execution.duration_ms))} ms`,
    );
  }
  if (typeof execution.credits_used === "number") {
    lines.push(
      `Credits used: ${Math.max(0, Math.floor(execution.credits_used))}`,
    );
  }

  const links = collectOutputLinks(execution.result);
  if (links.length > 0) {
    lines.push("");
    lines.push("Downloads:");
    for (const link of links) {
      lines.push(`- [${link.label}](${link.url})`);
    }
  }

  if (response.suggestions && response.suggestions.length > 0) {
    lines.push("");
    lines.push(`Next: ${response.suggestions.slice(0, 2).join(" | ")}`);
  }

  return lines.join("\n");
};

const SmartComposerSend: FC = () => {
  const text = useComposer((c) => c.text);
  const attachments = useComposer(
    (c) => c.attachments as unknown as ComposerAttachmentValue[],
  );
  const hasAttachments = useComposer((c) => c.attachments.length > 0);
  const composerRuntime = useComposerRuntime();
  const threadRuntime = useThreadRuntime();
  const [fastDispatching, setFastDispatching] = useState(false);
  const [fastDispatchError, setFastDispatchError] = useState<
    string | undefined
  >(undefined);
  const canSend = text.trim().length > 0 || hasAttachments;

  const onSend = async () => {
    const prompt = text.trim();
    if (!prompt) return;
    const attachmentDispatchToolId = hasAttachments
      ? resolveAttachmentImageTool(prompt)
      : undefined;
    const attachmentDispatchMode =
      resolveAttachmentDispatchMode(attachmentDispatchToolId);

    const shouldTryFastDispatch =
      !fastDispatching &&
      ((!hasAttachments && isLikelyToolIntent(prompt)) ||
        (hasAttachments && Boolean(attachmentDispatchToolId)));

    if (!shouldTryFastDispatch) {
      composerRuntime.send();
      return;
    }

    setFastDispatching(true);
    setFastDispatchError(undefined);
    try {
      const dispatched = attachmentDispatchToolId
        ? await (async () => {
            const attachmentFile = getFirstComposerImageFile(attachments);
            if (!attachmentFile) {
              composerRuntime.send();
              return null;
            }
            const fileUrl = await uploadComposerImageAttachment(attachmentFile);
            return dispatchPrompt({
              prompt,
              tool: attachmentDispatchToolId,
              mode: attachmentDispatchMode,
              params: {
                file_url: fileUrl,
              },
            });
          })()
        : await dispatchPrompt({
            prompt,
            mode: "sync",
          });

      if (!dispatched) {
        return;
      }

      if (dispatched.channel !== "fast" || !dispatched.match.matched) {
        composerRuntime.send();
        return;
      }

      if (!threadRuntime) {
        throw new Error("Thread runtime unavailable for fast-dispatch render.");
      }

      const runId = extractDispatchRunId(dispatched.execution);
      const assistantText = buildDispatchAssistantText(dispatched);
      await composerRuntime.reset();
      threadRuntime.append({
        role: "user",
        content: [{ type: "text", text: prompt }],
        startRun: false,
      });
      threadRuntime.append({
        role: "assistant",
        content: [{ type: "text", text: assistantText }],
        metadata: {
          custom: {
            ...(runId ? { runId } : {}),
            dispatchChannel: "fast",
            dispatchMode: dispatched.mode,
            tool: dispatched.match.tool,
            usedAttachmentDispatch: Boolean(attachmentDispatchToolId),
          },
        },
      });
    } catch (error) {
      console.error("Fast-dispatch render failed", error);
      setFastDispatchError(
        error instanceof Error ? error.message : "Fast-dispatch failed.",
      );
      composerRuntime.send();
    } finally {
      setFastDispatching(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <TooltipIconButton
        tooltip={
          fastDispatching
            ? "Running fast-dispatch"
            : "Send message (auto fast-dispatch for tool intents)"
        }
        side="bottom"
        type="button"
        variant="default"
        size="icon"
        className="aui-composer-send size-8 rounded-full"
        aria-label="Send message"
        disabled={!canSend || fastDispatching}
        onClick={() => {
          void onSend();
        }}
      >
        {fastDispatching ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : (
          <ArrowUpIcon className="aui-composer-send-icon size-4" />
        )}
      </TooltipIconButton>
      {fastDispatchError ? (
        <p className="max-w-56 text-right text-[10px] text-rose-500">
          {fastDispatchError}
        </p>
      ) : null}
    </div>
  );
};

const Composer: FC = () => {
  return (
    <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
      <ComposerPrimitive.AttachmentDropzone className="aui-composer-attachment-dropzone flex w-full flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(120,197,249,0.16),transparent_26%),linear-gradient(180deg,rgba(10,16,22,0.98),rgba(6,10,14,0.98))] px-2 pt-2 shadow-[0_20px_80px_rgba(0,0,0,0.38)] outline-none transition-[border-color,box-shadow,transform] has-[textarea:focus-visible]:border-sky-300/60 has-[textarea:focus-visible]:shadow-[0_24px_90px_rgba(8,145,178,0.18)] data-[dragging=true]:border-sky-300/70 data-[dragging=true]:bg-[linear-gradient(180deg,rgba(16,30,43,0.98),rgba(8,14,20,0.98))]">
        <ComposerAttachments />
        <ComposerPrimitive.Input
          placeholder="Describe the outcome, or say 16:9 poster / 9:16 reel / 4:5 cover / upload a file..."
          className="aui-composer-input mb-1 max-h-40 min-h-16 w-full resize-none bg-transparent px-5 pt-4 pb-4 text-[15px] leading-6 text-white outline-none placeholder:text-zinc-500 focus-visible:ring-0"
          rows={1}
          autoFocus
          aria-label="Message input"
        />
        <ComposerAction />
      </ComposerPrimitive.AttachmentDropzone>
    </ComposerPrimitive.Root>
  );
};

const ComposerAction: FC = () => {
  return (
    <div className="aui-composer-action-wrapper relative mx-2 mb-2 flex items-center justify-between border-white/8 border-t px-2 pt-3">
      <ComposerAddAttachment />
      <AuiIf condition={(s) => !s.thread.isRunning}>
        <SmartComposerSend />
      </AuiIf>
      <AuiIf condition={(s) => s.thread.isRunning}>
        <ComposerPrimitive.Cancel asChild>
          <Button
            type="button"
            variant="default"
            size="icon"
            className="aui-composer-cancel size-8 rounded-full"
            aria-label="Stop generating"
          >
            <SquareIcon className="aui-composer-cancel-icon size-3 fill-current" />
          </Button>
        </ComposerPrimitive.Cancel>
      </AuiIf>
    </div>
  );
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root mt-2 rounded-md border border-destructive bg-destructive/10 p-3 text-destructive text-sm dark:bg-destructive/5 dark:text-red-200">
        <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const AssistantMessage: FC = () => {
  const threadMessages = useThread((state) => state.messages);
  const isFastDispatchMessage = useMessage(
    (state) => state.metadata.custom.dispatchChannel === "fast",
  );
  const fastDispatchRunId = useMessage((state) => {
    const value = state.metadata.custom.runId;
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  });
  const messageIndex = useMessage((state) => state.index);
  const messagePartCount = useMessage((state) => state.content.length);
  const previousMessage =
    messageIndex > 0 ? threadMessages[messageIndex - 1] : undefined;
  const isDuplicateFastDispatchMessage =
    isFastDispatchMessage &&
    Boolean(fastDispatchRunId) &&
    previousMessage?.role === "assistant" &&
    previousMessage.metadata.custom.dispatchChannel === "fast" &&
    previousMessage.metadata.custom.runId === fastDispatchRunId;

  if (isDuplicateFastDispatchMessage) {
    return null;
  }

  return (
    <MessagePrimitive.Root
      className="aui-assistant-message-root fade-in slide-in-from-bottom-1 relative mx-auto w-full max-w-(--thread-max-width) animate-in py-3 duration-150"
      data-role="assistant"
    >
      <div className="aui-assistant-message-content wrap-break-word px-2 text-foreground leading-relaxed">
        {isFastDispatchMessage && messagePartCount > 0 ? (
          <MessagePrimitive.PartByIndex
            index={0}
            components={{
              Text: MarkdownText,
              Reasoning,
              ReasoningGroup,
              tools: { by_name: toolWidgets, Fallback: ToolFallback },
            }}
          />
        ) : (
          <MessagePrimitive.Parts
            components={{
              Text: MarkdownText,
              Reasoning,
              ReasoningGroup,
              tools: { by_name: toolWidgets, Fallback: ToolFallback },
            }}
          />
        )}
        <MessageError />
      </div>

      <div className="aui-assistant-message-footer mt-1 ml-2 flex">
        <BranchPicker />
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  );
};

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      autohideFloat="single-branch"
      className="aui-assistant-action-bar-root col-start-3 row-start-2 -ml-1 flex gap-1 text-muted-foreground data-floating:absolute data-floating:rounded-md data-floating:border data-floating:bg-background data-floating:p-1 data-floating:shadow-sm"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy">
          <AuiIf condition={(s) => s.message.isCopied}>
            <CheckIcon />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <CopyIcon />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip="Refresh">
          <RefreshCwIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger asChild>
          <TooltipIconButton
            tooltip="More"
            className="data-[state=open]:bg-accent"
          >
            <MoreHorizontalIcon />
          </TooltipIconButton>
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content
          side="bottom"
          align="start"
          className="aui-action-bar-more-content z-50 min-w-32 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <ActionBarPrimitive.ExportMarkdown asChild>
            <ActionBarMorePrimitive.Item className="aui-action-bar-more-item flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground">
              <DownloadIcon className="size-4" />
              Export as Markdown
            </ActionBarMorePrimitive.Item>
          </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
    </ActionBarPrimitive.Root>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      className="aui-user-message-root fade-in slide-in-from-bottom-1 mx-auto grid w-full max-w-(--thread-max-width) animate-in auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 py-3 duration-150 [&:where(>*)]:col-start-2"
      data-role="user"
    >
      <UserMessageAttachments />

      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        <div className="aui-user-message-content wrap-break-word rounded-2xl bg-muted px-4 py-2.5 text-foreground">
          <MessagePrimitive.Parts />
        </div>
        <div className="aui-user-action-bar-wrapper absolute top-1/2 left-0 -translate-x-full -translate-y-1/2 pr-2">
          <UserActionBar />
        </div>
      </div>

      <BranchPicker className="aui-user-branch-picker col-span-full col-start-1 row-start-3 -mr-1 justify-end" />
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-user-action-bar-root flex flex-col items-end"
    >
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton tooltip="Edit" className="aui-user-action-edit p-4">
          <PencilIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <MessagePrimitive.Root className="aui-edit-composer-wrapper mx-auto flex w-full max-w-(--thread-max-width) flex-col px-2 py-3">
      <ComposerPrimitive.Root className="aui-edit-composer-root ml-auto flex w-full max-w-[85%] flex-col rounded-2xl bg-muted">
        <ComposerPrimitive.Input
          className="aui-edit-composer-input min-h-14 w-full resize-none bg-transparent p-4 text-foreground text-sm outline-none"
          autoFocus
        />
        <div className="aui-edit-composer-footer mx-3 mb-3 flex items-center gap-2 self-end">
          <ComposerPrimitive.Cancel asChild>
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button size="sm">Update</Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({
  className,
  ...rest
}) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "aui-branch-picker-root mr-2 -ml-2 inline-flex items-center text-muted-foreground text-xs",
        className,
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip="Previous">
          <ChevronLeftIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="aui-branch-picker-state font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip="Next">
          <ChevronRightIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};
