import { existsSync } from "node:fs";
import path from "node:path";
import type {
  VidBeeConfig,
  VidBeeRuntimeSettings,
} from "./media-provider-config";

export type VidBeeDownloadType = "video" | "audio";

export type VidBeeVideoFormat = {
  acodec?: string;
  audioExt?: string;
  ext: string;
  filesize?: number;
  filesizeApprox?: number;
  formatId: string;
  formatNote?: string;
  fps?: number;
  height?: number;
  language?: string;
  protocol?: string;
  quality?: number;
  tbr?: number;
  vcodec?: string;
  videoExt?: string;
  width?: number;
};

export type VidBeeVideoInfo = {
  description?: string;
  duration?: number;
  extractorKey?: string;
  formats: VidBeeVideoFormat[];
  id: string;
  tags?: string[];
  thumbnail?: string;
  title: string;
  uploader?: string;
  viewCount?: number;
  webpageUrl?: string;
};

export type VidBeeDownloadProgress = {
  currentSpeed?: string;
  downloaded?: string;
  eta?: string;
  percent: number;
  total?: string;
};

export type VidBeeDownloadStatus =
  | "pending"
  | "downloading"
  | "processing"
  | "completed"
  | "error"
  | "cancelled";

export type VidBeeDownloadTask = {
  completedAt?: number;
  createdAt: number;
  description?: string;
  downloadPath?: string;
  duration?: number;
  error?: string;
  fileSize?: number;
  id: string;
  playlistId?: string;
  playlistIndex?: number;
  playlistSize?: number;
  playlistTitle?: string;
  progress?: VidBeeDownloadProgress;
  savedFileName?: string;
  selectedFormat?: VidBeeVideoFormat;
  speed?: string;
  startedAt?: number;
  status: VidBeeDownloadStatus;
  tags?: string[];
  thumbnail?: string;
  title?: string;
  type: VidBeeDownloadType;
  uploader?: string;
  url: string;
  viewCount?: number;
  ytDlpCommand?: string;
  ytDlpLog?: string;
};

export type VidBeeRemoteFile = {
  body: Buffer;
  contentLength?: number;
  contentType: string;
  filename: string;
};

type RpcSuccess<T> = {
  meta?: unknown;
  json: T;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const unwrapRpcPayload = <T>(value: unknown): T => {
  if (isRecord(value) && "json" in value) {
    return (value as RpcSuccess<T>).json;
  }
  return value as T;
};

const buildRpcCandidates = (
  input: unknown,
): Array<{ body?: unknown; method: "GET" | "POST" }> => {
  if (input === undefined) {
    return [
      { method: "GET" },
      { method: "POST", body: {} },
      { method: "POST", body: { json: null } },
      { method: "POST", body: { json: {} } },
    ];
  }
  return [
    { method: "POST", body: { json: input, meta: {} } },
    { method: "POST", body: { json: input } },
    { method: "POST", body: input },
  ];
};

const terminalStatuses = new Set<VidBeeDownloadStatus>([
  "completed",
  "error",
  "cancelled",
]);

const decodeContentDispositionFilename = (
  value: string | null,
): string | undefined => {
  if (!value) {
    return undefined;
  }
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const plainMatch = value.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1]?.trim() || undefined;
};

export class VidBeeClient {
  constructor(private readonly config: VidBeeConfig) {}

  private assertConfigured(): string {
    const baseUrl = this.config.baseUrl?.trim();
    if (!baseUrl) {
      throw new Error(
        "vidbee_unconfigured: OMNIAGENT_VIDBEE_BASE_URL or VIDBEE_API_URL is required.",
      );
    }
    return baseUrl;
  }

  private async rpc<T>(routePath: string, input?: unknown): Promise<T> {
    const baseUrl = this.assertConfigured();
    const endpoint = `${baseUrl}/rpc/${routePath}`;
    const errors: string[] = [];

    for (const candidate of buildRpcCandidates(input)) {
      const headers: Record<string, string> = {};
      if (candidate.body !== undefined) {
        headers["content-type"] = "application/json";
      }
      if (this.config.apiKey) {
        headers.authorization = `Bearer ${this.config.apiKey}`;
      }
      try {
        const response = await fetch(endpoint, {
          method: candidate.method,
          headers,
          body:
            candidate.method === "POST" && candidate.body !== undefined
              ? JSON.stringify(candidate.body)
              : undefined,
          cache: "no-store",
          signal: AbortSignal.timeout(this.config.requestTimeoutMs),
        });
        const rawText = await response.text();
        if (!response.ok) {
          errors.push(
            `${candidate.method} ${response.status}: ${rawText.slice(0, 500) || response.statusText}`,
          );
          continue;
        }
        if (!rawText.trim()) {
          return {} as T;
        }
        try {
          return unwrapRpcPayload<T>(JSON.parse(rawText));
        } catch (error) {
          errors.push(
            `${candidate.method} invalid_json: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    throw new Error(
      `vidbee_rpc_failed: ${routePath} request failed. ${errors.join(" | ")}`.slice(
        0,
        2000,
      ),
    );
  }

  async getVideoInfo(
    url: string,
    settings?: VidBeeRuntimeSettings,
  ): Promise<VidBeeVideoInfo> {
    const payload = await this.rpc<{ video: VidBeeVideoInfo }>("videoInfo", {
      url,
      ...(settings ? { settings } : {}),
    });
    return payload.video;
  }

  async createDownload(input: {
    audioFormat?: string;
    audioFormatIds?: string[];
    customDownloadPath?: string;
    customFilenameTemplate?: string;
    description?: string;
    duration?: number;
    format?: string;
    selectedFormat?: VidBeeVideoFormat;
    settings?: VidBeeRuntimeSettings;
    tags?: string[];
    thumbnail?: string;
    title?: string;
    type: VidBeeDownloadType;
    uploader?: string;
    url: string;
    viewCount?: number;
  }): Promise<VidBeeDownloadTask> {
    const payload = await this.rpc<{ download: VidBeeDownloadTask }>(
      "downloads/create",
      input,
    );
    return payload.download;
  }

  async listDownloads(): Promise<VidBeeDownloadTask[]> {
    const payload = await this.rpc<{ downloads: VidBeeDownloadTask[] }>(
      "downloads/list",
    );
    return Array.isArray(payload.downloads) ? payload.downloads : [];
  }

  async listHistory(): Promise<VidBeeDownloadTask[]> {
    const payload = await this.rpc<{ history: VidBeeDownloadTask[] }>(
      "history/list",
    );
    return Array.isArray(payload.history) ? payload.history : [];
  }

  async waitForDownload(id: string): Promise<VidBeeDownloadTask> {
    const deadline = Date.now() + this.config.maxWaitMs;
    let lastSeen: VidBeeDownloadTask | undefined;

    while (Date.now() <= deadline) {
      const [downloads, history] = await Promise.all([
        this.listDownloads().catch(() => []),
        this.listHistory().catch(() => []),
      ]);
      const task =
        downloads.find((entry) => entry.id === id) ??
        history.find((entry) => entry.id === id) ??
        lastSeen;
      if (task) {
        lastSeen = task;
        if (terminalStatuses.has(task.status)) {
          return task;
        }
      }
      await sleep(this.config.pollIntervalMs);
    }

    throw new Error(
      `vidbee_timeout: download ${id} did not finish within ${this.config.maxWaitMs}ms.`,
    );
  }

  resolveLocalFilePath(task: VidBeeDownloadTask): string | undefined {
    const savedFileName = task.savedFileName?.trim();
    const downloadPath = task.downloadPath?.trim();
    const configuredDownloadDir =
      this.config.runtimeSettings.downloadPath?.trim();
    const candidates = new Set<string>();

    if (downloadPath && savedFileName) {
      candidates.add(path.join(downloadPath, savedFileName));
    }
    if (configuredDownloadDir && savedFileName) {
      candidates.add(path.join(configuredDownloadDir, savedFileName));
    }
    if (downloadPath && !savedFileName) {
      candidates.add(downloadPath);
    }

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    return Array.from(candidates)[0];
  }

  async downloadRemoteFile(
    task: VidBeeDownloadTask,
  ): Promise<VidBeeRemoteFile | undefined> {
    const fileBridgeUrl = this.config.fileBridgeUrl?.trim();
    if (!fileBridgeUrl) {
      return undefined;
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    const bridgeApiKey =
      this.config.fileBridgeApiKey?.trim() || this.config.apiKey?.trim();
    if (bridgeApiKey) {
      headers.authorization = `Bearer ${bridgeApiKey}`;
    }

    const resolvedPath = this.resolveLocalFilePath(task);
    const response = await fetch(fileBridgeUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        downloadPath: task.downloadPath,
        filePath: resolvedPath,
        savedFileName: task.savedFileName,
        taskId: task.id,
        taskUrl: task.url,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(this.config.requestTimeoutMs),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `vidbee_file_bridge_failed: ${response.status} ${body.slice(0, 500)}`,
      );
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const filename =
      decodeContentDispositionFilename(
        response.headers.get("content-disposition"),
      ) ||
      task.savedFileName?.trim() ||
      `${task.id}.${task.selectedFormat?.ext || (task.type === "audio" ? "mp3" : "mp4")}`;

    return {
      body: bytes,
      contentLength: bytes.byteLength,
      contentType:
        response.headers.get("content-type") || "application/octet-stream",
      filename,
    };
  }
}
