// @input: IOPaint request payloads and local image URLs
// @output: Managed local IOPaint service with typed helpers for inpaint and plugin APIs
// @position: shared image AI service adapter for backend tools and studio UI

import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
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

type IOPaintPluginInfo = {
  name: string;
  support_gen_image?: boolean;
  support_gen_mask?: boolean;
};

export type IOPaintModelInfo = {
  name: string;
  path: string;
  model_type: string;
  need_prompt?: boolean;
  controlnets?: string[];
  brushnets?: string[];
  support_strength?: boolean;
  support_outpainting?: boolean;
  support_lcm_lora?: boolean;
  support_controlnet?: boolean;
  support_brushnet?: boolean;
  support_powerpaint_v2?: boolean;
};

export type IOPaintServerConfig = {
  plugins: IOPaintPluginInfo[];
  modelInfos: IOPaintModelInfo[];
  removeBGModel?: string;
  removeBGModels?: string[];
  realesrganModel?: string;
  realesrganModels?: string[];
  interactiveSegModel?: string;
  interactiveSegModels?: string[];
  enableFileManager?: boolean;
  enableAutoSaving?: boolean;
  enableControlnet?: boolean;
  controlnetMethod?: string | null;
  disableModelSwitch?: boolean;
  isDesktop?: boolean;
  samplers?: string[];
};

export type IOPaintImageBinary = {
  buffer: Buffer;
  contentType: string;
  ext: string;
  seed?: string;
};

type IOPaintSwitchModelResponse = IOPaintModelInfo;

export type IOPaintInpaintPayload = {
  image: string;
  mask: string;
} & Record<string, unknown>;

export type IOPaintRunPluginPayload = {
  name: string;
  image: string;
  clicks?: number[][];
  scale?: number;
};

export type IOPaintAdjustMaskPayload = {
  mask: string;
  operate: "expand" | "shrink" | "reverse";
  kernel_size?: number;
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 17860;
const DEFAULT_MODEL = "lama";
const DEFAULT_DEVICE = "cpu";
const SERVICE_BOOT_TIMEOUT_MS = 120_000;
const HEALTH_TIMEOUT_MS = 2_500;

const serviceState = (() => {
  const globalKey = "__omni_iopaint_service_state__";
  const globalObject = globalThis as typeof globalThis & {
    [globalKey]?: ManagedServiceState;
  };
  if (!globalObject[globalKey]) {
    globalObject[globalKey] = {};
  }
  return globalObject[globalKey] as ManagedServiceState;
})();

const defaultSharedPython = join(serviceRoot, "venvs", "remwm", "Scripts", "python.exe");
const defaultDedicatedPython = join(serviceRoot, "venvs", "iopaint", "Scripts", "python.exe");
const pythonBin = pickPythonExecutable(
  [
    process.env.OMNIAGENT_IOPAINT_PYTHON?.trim() || "",
    defaultDedicatedPython,
    defaultSharedPython,
  ],
  "python",
);
const workdir = resolve(
  process.env.OMNIAGENT_IOPAINT_WORKDIR?.trim() || join(workspaceRoot, ".vendor", "iopaint"),
);
const modelDir = resolve(
  process.env.OMNIAGENT_IOPAINT_MODEL_DIR?.trim() || join(serviceRoot, "models", "iopaint"),
);
const torchHubCheckpointDir = resolve(join(modelDir, "torch", "hub", "checkpoints"));
const rmbg14ModelPath = resolve(join(torchHubCheckpointDir, "briaai-RMBG-1.4-model.pth"));
const rmbg20ModelDir = resolve(join(modelDir, "hf", "briaai-RMBG-2.0"));
const outputDir = resolve(
  process.env.OMNIAGENT_IOPAINT_OUTPUT_DIR?.trim() || join(serviceRoot, "outputs", "iopaint"),
);
const scriptPath = resolve(
  process.env.OMNIAGENT_IOPAINT_SCRIPT?.trim() ||
    join(workspaceRoot, "scripts", "python", "iopaint_service.py"),
);
const host = process.env.OMNIAGENT_IOPAINT_HOST?.trim() || DEFAULT_HOST;
const port = Number(process.env.OMNIAGENT_IOPAINT_PORT || DEFAULT_PORT);
const model = process.env.OMNIAGENT_IOPAINT_MODEL?.trim() || DEFAULT_MODEL;
const device = process.env.OMNIAGENT_IOPAINT_DEVICE?.trim() || DEFAULT_DEVICE;

const baseUrl = process.env.OMNIAGENT_IOPAINT_BASE_URL?.trim() || `http://${host}:${port}`;

export const getIOPaintBaseUrl = (): string => baseUrl;

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
};

const withTimeout = async <T>(input: string, init: RequestInit = {}, timeoutMs = HEALTH_TIMEOUT_MS): Promise<T> => {
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
      throw new Error(`IOPaint request failed (${response.status}): ${text.slice(0, 240)}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
};

const fetchBinary = async (input: string, init: RequestInit = {}, timeoutMs = 60_000): Promise<IOPaintImageBinary> => {
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
      throw new Error(`IOPaint request failed (${response.status}): ${text.slice(0, 240)}`);
    }
    const contentType = response.headers.get("content-type")?.trim() || "image/png";
    const buffer = Buffer.from(await response.arrayBuffer());
    const ext = contentType.split("/")[1]?.split(";")[0]?.trim() || "png";
    return {
      buffer,
      contentType,
      ext,
      seed: response.headers.get("X-Seed") || undefined,
    };
  } finally {
    clearTimeout(timer);
  }
};

const isHealthy = async (): Promise<boolean> => {
  try {
    await withTimeout<IOPaintServerConfig>(`${baseUrl}/api/v1/server-config`);
    return true;
  } catch {
    return false;
  }
};

const spawnService = (): void => {
  if (!existsSync(workdir)) {
    throw new Error(`IOPaint workdir not found: ${workdir}`);
  }

  if (!existsSync(scriptPath)) {
    throw new Error(`IOPaint service script not found: ${scriptPath}`);
  }

  spawnDetachedPythonService({
    pythonBin,
    scriptPath,
    cwd: workspaceRoot,
    stdoutName: "iopaint.stdout.log",
    stderrName: "iopaint.stderr.log",
    noProxyHosts: [host],
    extraEnv: {
      OMNIAGENT_RMBG_14_MODEL_PATH: rmbg14ModelPath,
      OMNIAGENT_RMBG_20_MODEL_DIR: rmbg20ModelDir,
    },
    args: [
      "--host",
      host,
      "--port",
      String(port),
      "--source-root",
      workdir,
      "--model",
      model,
      "--device",
      device,
      "--model-dir",
      modelDir,
      "--output-dir",
      outputDir,
      "--enable-interactive-seg",
      "--enable-remove-bg",
      "--enable-realesrgan",
      "--enable-gfpgan",
      "--enable-restoreformer",
    ],
  });
};

const waitForHealthy = async (): Promise<void> => {
  const deadline = Date.now() + SERVICE_BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isHealthy()) {
      return;
    }
    await delay(1_000);
  }
  throw new Error(
    `IOPaint did not become ready at ${baseUrl} within ${SERVICE_BOOT_TIMEOUT_MS}ms`,
  );
};

export const ensureIOPaintService = async (): Promise<void> => {
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

export const fetchIOPaintServerConfig = async (): Promise<IOPaintServerConfig> => {
  await ensureIOPaintService();
  return withTimeout<IOPaintServerConfig>(`${baseUrl}/api/v1/server-config`);
};

export const fetchIOPaintCurrentModel = async (): Promise<IOPaintModelInfo> => {
  await ensureIOPaintService();
  return withTimeout<IOPaintModelInfo>(`${baseUrl}/api/v1/model`);
};

export const switchIOPaintModel = async (name: string): Promise<IOPaintSwitchModelResponse> => {
  await ensureIOPaintService();
  return withTimeout<IOPaintSwitchModelResponse>(`${baseUrl}/api/v1/model`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  }, 30_000);
};

export const switchIOPaintPluginModel = async (
  pluginName: string,
  modelName: string,
): Promise<void> => {
  await ensureIOPaintService();
  await withTimeout<Record<string, never>>(
    `${baseUrl}/api/v1/switch_plugin_model`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plugin_name: pluginName, model_name: modelName }),
    },
    30_000,
  );
};

export const runIOPaintInpaint = async (
  payload: IOPaintInpaintPayload,
): Promise<IOPaintImageBinary> => {
  await ensureIOPaintService();
  return fetchBinary(`${baseUrl}/api/v1/inpaint`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }, 120_000);
};

export const runIOPaintPluginImage = async (
  payload: IOPaintRunPluginPayload,
): Promise<IOPaintImageBinary> => {
  await ensureIOPaintService();
  return fetchBinary(`${baseUrl}/api/v1/run_plugin_gen_image`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }, 120_000);
};

export const runIOPaintPluginMask = async (
  payload: IOPaintRunPluginPayload,
): Promise<IOPaintImageBinary> => {
  await ensureIOPaintService();
  return fetchBinary(`${baseUrl}/api/v1/run_plugin_gen_mask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }, 120_000);
};

export const runIOPaintAdjustMask = async (
  payload: IOPaintAdjustMaskPayload,
): Promise<IOPaintImageBinary> => {
  await ensureIOPaintService();
  return fetchBinary(`${baseUrl}/api/v1/adjust_mask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }, 30_000);
};

export const imageUrlToDataUrl = async (fileUrl: string): Promise<string> => {
  const response = await fetch(fileUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch image ${fileUrl}: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const mime =
    response.headers.get("content-type")?.trim() ||
    MIME_BY_EXT[extname(fileUrl).toLowerCase()] ||
    "image/png";
  return bufferToDataUrl(buffer, mime);
};

export const bufferToDataUrl = (buffer: Buffer, mimeType = "image/png"): string => {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
};
