import { publicEnv } from "@/lib/config/public-env";

type ApiEnvelope<T> = {
  ok: boolean;
  result?: T;
  error?: string;
};

const withApiKeyHeader = (headers?: HeadersInit): Headers => {
  const merged = new Headers(headers);
  const apiKey = publicEnv.apiKey?.trim();
  if (apiKey) {
    merged.set("x-api-key", apiKey);
  }
  return merged;
};

const ensureOk = async <T>(response: Response): Promise<T> => {
  const body = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || !body.ok || !body.result) {
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  return body.result;
};

const getJson = async <T>(path: string): Promise<T> => {
  const response = await fetch(path, {
    cache: "no-store",
    headers: withApiKeyHeader(),
  });
  return ensureOk<T>(response);
};

const postJson = async <T>(path: string, payload: Record<string, unknown>): Promise<T> => {
  const response = await fetch(path, {
    method: "POST",
    headers: withApiKeyHeader({ "content-type": "application/json" }),
    body: JSON.stringify(payload),
  });
  return ensureOk<T>(response);
};

export type StudioImageResult = {
  output_file_url: string;
  preview_url?: string;
  filename?: string;
  format?: string;
  width?: number;
  height?: number;
  size_bytes?: number;
  detail_text?: string;
  strategy?: string;
  seed?: string;
  [key: string]: unknown;
};

export type StudioMaskResult = {
  output_file_url?: string;
  preview_url?: string;
  mask_data_url?: string;
  polygon_count?: number;
  coverage?: number;
  width?: number;
  height?: number;
  [key: string]: unknown;
};

export const getIOPaintServerConfig = async <T>(): Promise<T> =>
  getJson<T>("/api/iopaint/server-config");

export const getIOPaintCurrentModel = async <T>(): Promise<T> =>
  getJson<T>("/api/iopaint/model");

export const switchIOPaintModel = async <T>(name: string): Promise<T> =>
  postJson<T>("/api/iopaint/model", { name });

export const switchIOPaintPluginModel = async (
  pluginName: string,
  modelName: string,
): Promise<Record<string, unknown>> =>
  postJson<Record<string, unknown>>("/api/iopaint/switch-plugin-model", {
    plugin_name: pluginName,
    model_name: modelName,
  });

export const runIOPaintInpaint = async (
  payload: Record<string, unknown>,
): Promise<StudioImageResult> =>
  postJson<StudioImageResult>("/api/iopaint/inpaint", payload);

export const runIOPaintPluginImage = async (
  payload: Record<string, unknown>,
): Promise<StudioImageResult> =>
  postJson<StudioImageResult>("/api/iopaint/run-plugin-gen-image", payload);

export const runIOPaintPluginMask = async (
  payload: Record<string, unknown>,
): Promise<StudioMaskResult> =>
  postJson<StudioMaskResult>("/api/iopaint/run-plugin-gen-mask", payload);

export const runIOPaintAdjustMask = async (
  payload: Record<string, unknown>,
): Promise<StudioMaskResult> =>
  postJson<StudioMaskResult>("/api/iopaint/adjust-mask", payload);

export const detectRemwmMask = async (
  payload: Record<string, unknown>,
): Promise<StudioMaskResult> =>
  postJson<StudioMaskResult>("/api/iopaint/remwm/detect-mask", payload);
