import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getServerEnv } from "@/lib/server/env";
import type { UsageStatus } from "@/lib/server/usage-ledger";

export type JobTerminalWebhookInput = {
  apiKeyId: string;
  creditsUsed: number;
  durationMs?: number;
  errorCode?: string;
  errorMessage?: string;
  jobId: string;
  runId: string;
  status: UsageStatus;
  tenantId: string;
  tool: string;
};

type WebhookEnvelope = {
  created_at: number;
  data: {
    api_key_id: string;
    credits_used: number;
    duration_ms?: number;
    error?: {
      code?: string;
      message?: string;
    };
    job_id: string;
    run_id: string;
    status: UsageStatus;
    tenant_id: string;
    tool: string;
  };
  id: string;
  type: "job.completed" | "job.failed";
};

const STORAGE_ROOT =
  process.env.OMNIAGENT_LOCAL_STATE_DIR?.trim() ||
  join(process.cwd(), ".omniagent-state");
const DEAD_LETTER_DIR = join(STORAGE_ROOT, "webhook-dead-letter");
const DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RETRY_DELAY_MS = 60_000;
const deliveredEventTimestamps = new Map<string, number>();

const normalizeError = (input: JobTerminalWebhookInput) => {
  if (!input.errorCode && !input.errorMessage) {
    return undefined;
  }
  return {
    code: input.errorCode,
    message: input.errorMessage,
  };
};

const normalizeEventType = (
  status: UsageStatus,
): "job.completed" | "job.failed" => {
  if (status === "succeeded") {
    return "job.completed";
  }
  return "job.failed";
};

const sanitizeFileName = (value: string): string => {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_.-]/g, "_");
  return normalized || "event";
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const pruneDeliveredIndex = (): void => {
  const now = Date.now();
  for (const [eventId, createdAt] of deliveredEventTimestamps.entries()) {
    if (now - createdAt > DEDUPE_TTL_MS) {
      deliveredEventTimestamps.delete(eventId);
    }
  }
};

export const buildWebhookSignature = (
  secret: string,
  timestamp: number,
  rawBody: string,
): string => {
  const payload = `${timestamp}.${rawBody}`;
  return createHmac("sha256", secret).update(payload).digest("hex");
};

const persistDeadLetter = (
  envelope: WebhookEnvelope,
  attempts: number,
  reason: string,
): void => {
  if (!existsSync(DEAD_LETTER_DIR)) {
    mkdirSync(DEAD_LETTER_DIR, { recursive: true });
  }
  const payload = {
    attempts,
    envelope,
    failed_at: Date.now(),
    reason,
  };
  const fileSafeId = sanitizeFileName(envelope.id);
  const finalPath = join(DEAD_LETTER_DIR, `${fileSafeId}.json`);
  const tempPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, JSON.stringify(payload), "utf8");
  renameSync(tempPath, finalPath);
};

const postWebhook = async (
  url: string,
  timeoutMs: number,
  rawBody: string,
  headers: Record<string, string>,
): Promise<{ ok: true } | { message: string; ok: false }> => {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort("webhook timeout"),
    timeoutMs,
  );
  try {
    const response = await fetch(url, {
      body: rawBody,
      headers,
      method: "POST",
      signal: controller.signal,
    });
    if (response.ok) {
      return { ok: true };
    }
    const body = await response.text();
    return {
      ok: false,
      message: `status=${response.status} body=${body.slice(0, 300)}`,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
};

export const emitJobTerminalWebhook = async (
  input: JobTerminalWebhookInput,
): Promise<void> => {
  const env = getServerEnv();
  const webhookUrl = env.billingWebhookUrl?.trim();
  if (!webhookUrl) {
    return;
  }

  const eventType = normalizeEventType(input.status);
  const eventId = `${eventType}:${input.jobId}`;
  pruneDeliveredIndex();
  if (deliveredEventTimestamps.has(eventId)) {
    return;
  }

  const envelope: WebhookEnvelope = {
    created_at: Date.now(),
    data: {
      api_key_id: input.apiKeyId,
      credits_used: input.creditsUsed,
      duration_ms: input.durationMs,
      error: normalizeError(input),
      job_id: input.jobId,
      run_id: input.runId,
      status: input.status,
      tenant_id: input.tenantId,
      tool: input.tool,
    },
    id: eventId,
    type: eventType,
  };

  const rawBody = JSON.stringify(envelope);
  const maxAttempts = Math.max(1, env.billingWebhookMaxAttempts);
  const timeoutMs = Math.max(1000, env.billingWebhookTimeoutMs);
  const retryBaseMs = Math.max(250, env.billingWebhookRetryBaseMs);

  let lastFailureReason = "unknown";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const timestamp = Date.now();
    const signature = env.billingWebhookSecret
      ? buildWebhookSignature(env.billingWebhookSecret, timestamp, rawBody)
      : "";
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-omni-event-id": envelope.id,
      "x-omni-event-type": envelope.type,
      "x-omni-timestamp": String(timestamp),
    };
    if (signature) {
      headers["x-omni-signature"] = `t=${timestamp},v1=${signature}`;
    }

    const posted = await postWebhook(webhookUrl, timeoutMs, rawBody, headers);
    if (posted.ok) {
      deliveredEventTimestamps.set(eventId, Date.now());
      return;
    }

    lastFailureReason = posted.message;
    if (attempt < maxAttempts) {
      const retryDelay = Math.min(
        MAX_RETRY_DELAY_MS,
        retryBaseMs * 2 ** (attempt - 1),
      );
      await sleep(retryDelay);
    }
  }

  persistDeadLetter(envelope, maxAttempts, lastFailureReason);
};
