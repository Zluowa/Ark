// @input: local image paths for watermark detection
// @output: managed rem-wm sidecar service with single and batch mask detection helpers
// @position: shared Florence-based watermark mask adapter for backend tools

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  pickPythonExecutable,
  serviceRoot,
  spawnDetachedPythonService,
  workspaceRoot,
} from "./service-runtime";

type ManagedServiceState = {
  starting?: Promise<void>;
};

export type RemwmMaskDetection = {
  ok: boolean;
  image_path: string;
  mask_path?: string | null;
  width: number;
  height: number;
  polygon_count: number;
  coverage: number;
  model_id: string;
  device: string;
};

type RemwmBatchDetectionResponse = {
  ok: boolean;
  items: RemwmMaskDetection[];
};

type DetectMaskPayload = {
  image_path: string;
  save_mask_path?: string;
  task_prompt?: string;
  text_input?: string;
  max_new_tokens?: number;
  num_beams?: number;
};

type DetectMaskBatchPayload = {
  image_paths: string[];
  output_dir?: string;
  task_prompt?: string;
  text_input?: string;
  max_new_tokens?: number;
  num_beams?: number;
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 17861;
const localFlorenceBaseFtDir = resolve(
  process.env.OMNIAGENT_REMWM_LOCAL_MODEL_DIR?.trim() ||
    join(serviceRoot, "models", "remwm", "Florence-2-base-ft"),
);
const DEFAULT_MODEL_ID = existsSync(localFlorenceBaseFtDir)
  ? localFlorenceBaseFtDir
  : "microsoft/Florence-2-large";
const DEFAULT_DEVICE = process.env.OMNIAGENT_REMWM_DEVICE?.trim() || "cpu";
const HEALTH_TIMEOUT_MS = 2_500;
const SERVICE_BOOT_TIMEOUT_MS = 180_000;

const serviceState = (() => {
  const globalKey = "__omni_remwm_service_state__";
  const globalObject = globalThis as typeof globalThis & {
    [globalKey]?: ManagedServiceState;
  };
  if (!globalObject[globalKey]) {
    globalObject[globalKey] = {};
  }
  return globalObject[globalKey] as ManagedServiceState;
})();

const defaultSharedPython = join(serviceRoot, "venvs", "remwm", "Scripts", "python.exe");
const pythonBin = pickPythonExecutable(
  [
    process.env.OMNIAGENT_REMWM_PYTHON?.trim() || "",
    defaultSharedPython,
  ],
  "python",
);

const scriptPath = resolve(
  process.env.OMNIAGENT_REMWM_SCRIPT?.trim() ||
    join(workspaceRoot, "scripts", "python", "remwm_service.py"),
);

const host = process.env.OMNIAGENT_REMWM_HOST?.trim() || DEFAULT_HOST;
const port = Number(process.env.OMNIAGENT_REMWM_PORT || DEFAULT_PORT);
const modelId = process.env.OMNIAGENT_REMWM_MODEL_ID?.trim() || DEFAULT_MODEL_ID;
const device = process.env.OMNIAGENT_REMWM_DEVICE?.trim() || DEFAULT_DEVICE;
const baseUrl =
  process.env.OMNIAGENT_REMWM_BASE_URL?.trim() || `http://${host}:${port}`;

const withTimeout = async <T>(
  input: string,
  init: RequestInit = {},
  timeoutMs = HEALTH_TIMEOUT_MS,
): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`rem-wm request failed (${response.status}): ${text.slice(0, 240)}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
};

const isHealthy = async (): Promise<boolean> => {
  try {
    await withTimeout<Record<string, unknown>>(`${baseUrl}/health`);
    return true;
  } catch {
    return false;
  }
};

const spawnService = (): void => {
  if (!existsSync(scriptPath)) {
    throw new Error(`rem-wm service script not found: ${scriptPath}`);
  }
  spawnDetachedPythonService({
    pythonBin,
    scriptPath,
    stdoutName: "remwm.stdout.log",
    stderrName: "remwm.stderr.log",
    noProxyHosts: [host],
    args: [
      "--host",
      host,
      "--port",
      String(port),
      "--model-id",
      modelId,
      "--device",
      device,
    ],
  });
};

const waitForHealthy = async (): Promise<void> => {
  const deadline = Date.now() + SERVICE_BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isHealthy()) return;
    await delay(1_000);
  }
  throw new Error(
    `rem-wm did not become ready at ${baseUrl} within ${SERVICE_BOOT_TIMEOUT_MS}ms`,
  );
};

export const ensureRemwmService = async (): Promise<void> => {
  if (await isHealthy()) return;
  if (!serviceState.starting) {
    serviceState.starting = (async () => {
      if (!(await isHealthy())) {
        spawnService();
      }
      await waitForHealthy();
    })()
      .catch((error) => {
        serviceState.starting = undefined;
        throw error;
      })
      .finally(() => {
        serviceState.starting = undefined;
      });
  }
  await serviceState.starting;
};

export const detectRemwmMask = async (
  payload: DetectMaskPayload,
): Promise<RemwmMaskDetection> => {
  await ensureRemwmService();
  return withTimeout<RemwmMaskDetection>(`${baseUrl}/v1/detect-mask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }, 180_000);
};

export const detectRemwmMaskBatch = async (
  payload: DetectMaskBatchPayload,
): Promise<RemwmBatchDetectionResponse> => {
  await ensureRemwmService();
  return withTimeout<RemwmBatchDetectionResponse>(`${baseUrl}/v1/detect-mask-batch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }, 240_000);
};
