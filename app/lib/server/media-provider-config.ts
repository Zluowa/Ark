export type MediaProviderName = "legacy_internal" | "vidbee";

export type MediaOperation = "video_info" | "download_video" | "download_audio";

export type VidBeeRuntimeSettings = {
  downloadPath?: string;
  browserForCookies?: string;
  cookiesPath?: string;
  proxy?: string;
  configPath?: string;
  embedSubs?: boolean;
  embedThumbnail?: boolean;
  embedMetadata?: boolean;
  embedChapters?: boolean;
};

export type VidBeeConfig = {
  apiKey?: string;
  baseUrl?: string;
  fileBridgeApiKey?: string;
  fileBridgeUrl?: string;
  maxWaitMs: number;
  pollIntervalMs: number;
  requestTimeoutMs: number;
  runtimeSettings: VidBeeRuntimeSettings;
};

export type MediaProviderPlatformOverrides = Record<
  MediaOperation,
  Partial<Record<MediaProviderName, string[]>>
>;

export type MediaProviderConfig = {
  defaultProvider: MediaProviderName;
  fallbackEnabled: boolean;
  platformOverrides: MediaProviderPlatformOverrides;
  providers: Record<MediaOperation, MediaProviderName>;
  vidbee: VidBeeConfig;
};

const normalize = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const stripTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

const parseStringList = (...values: Array<string | undefined>): string[] => {
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) {
      continue;
    }
    for (const item of value.split(",")) {
      const normalized = item.trim().toLowerCase();
      if (normalized) {
        seen.add(normalized);
      }
    }
  }
  return Array.from(seen);
};

const parsePositiveInt = (
  value: string | undefined,
  fallback: number,
): number => {
  const raw = value?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
};

const parseBoolean = (
  value: string | undefined,
  fallback: boolean,
): boolean => {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no") {
    return false;
  }
  return fallback;
};

const parseOptionalBoolean = (
  value: string | undefined,
): boolean | undefined => {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no") {
    return false;
  }
  return undefined;
};

const parseProvider = (
  value: string | undefined,
  fallback: MediaProviderName,
): MediaProviderName => {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "vidbee") {
    return "vidbee";
  }
  if (
    normalized === "legacy_internal" ||
    normalized === "legacy" ||
    normalized === "internal"
  ) {
    return "legacy_internal";
  }
  return fallback;
};

const operationEnvKey = (operation: MediaOperation): string => {
  switch (operation) {
    case "video_info":
      return "VIDEO_INFO";
    case "download_video":
      return "DOWNLOAD_VIDEO";
    case "download_audio":
      return "DOWNLOAD_AUDIO";
    default:
      return "VIDEO_INFO";
  }
};

export const getMediaProviderConfig = (): MediaProviderConfig => {
  const vidbeeBaseUrl = normalize(
    process.env.OMNIAGENT_VIDBEE_BASE_URL ?? process.env.VIDBEE_API_URL,
  );
  const defaultProvider = parseProvider(
    process.env.OMNIAGENT_MEDIA_PROVIDER,
    vidbeeBaseUrl ? "vidbee" : "legacy_internal",
  );
  const platformOverrides = (
    ["video_info", "download_video", "download_audio"] as MediaOperation[]
  ).reduce<MediaProviderPlatformOverrides>(
    (acc, operation) => {
      const opKey = operationEnvKey(operation);
      acc[operation] = {
        legacy_internal: parseStringList(
          process.env.OMNIAGENT_MEDIA_PROVIDER_LEGACY_PLATFORMS,
          process.env[`OMNIAGENT_MEDIA_PROVIDER_${opKey}_LEGACY_PLATFORMS`],
        ),
        vidbee: parseStringList(
          process.env.OMNIAGENT_MEDIA_PROVIDER_VIDBEE_PLATFORMS,
          process.env[`OMNIAGENT_MEDIA_PROVIDER_${opKey}_VIDBEE_PLATFORMS`],
        ),
      };
      return acc;
    },
    {
      video_info: {},
      download_video: {},
      download_audio: {},
    },
  );

  return {
    defaultProvider,
    fallbackEnabled: parseBoolean(
      process.env.OMNIAGENT_MEDIA_PROVIDER_FALLBACK_ENABLED,
      true,
    ),
    platformOverrides,
    providers: {
      video_info: parseProvider(
        process.env.OMNIAGENT_MEDIA_PROVIDER_VIDEO_INFO,
        defaultProvider,
      ),
      download_video: parseProvider(
        process.env.OMNIAGENT_MEDIA_PROVIDER_DOWNLOAD_VIDEO,
        defaultProvider,
      ),
      download_audio: parseProvider(
        process.env.OMNIAGENT_MEDIA_PROVIDER_DOWNLOAD_AUDIO,
        defaultProvider,
      ),
    },
    vidbee: {
      apiKey: normalize(process.env.OMNIAGENT_VIDBEE_API_KEY),
      baseUrl: vidbeeBaseUrl ? stripTrailingSlash(vidbeeBaseUrl) : undefined,
      fileBridgeApiKey: normalize(
        process.env.OMNIAGENT_VIDBEE_FILE_BRIDGE_API_KEY,
      ),
      fileBridgeUrl: normalize(process.env.OMNIAGENT_VIDBEE_FILE_BRIDGE_URL),
      maxWaitMs: parsePositiveInt(
        process.env.OMNIAGENT_VIDBEE_MAX_WAIT_MS,
        90_000,
      ),
      pollIntervalMs: parsePositiveInt(
        process.env.OMNIAGENT_VIDBEE_POLL_INTERVAL_MS,
        1_000,
      ),
      requestTimeoutMs: parsePositiveInt(
        process.env.OMNIAGENT_VIDBEE_REQUEST_TIMEOUT_MS,
        60_000,
      ),
      runtimeSettings: {
        browserForCookies: normalize(
          process.env.OMNIAGENT_VIDBEE_BROWSER_FOR_COOKIES,
        ),
        configPath: normalize(process.env.OMNIAGENT_VIDBEE_CONFIG_PATH),
        cookiesPath: normalize(
          process.env.OMNIAGENT_VIDBEE_COOKIES_PATH ??
            process.env.VIDBEE_COOKIES_PATH,
        ),
        downloadPath: normalize(
          process.env.OMNIAGENT_VIDBEE_DOWNLOAD_DIR ??
            process.env.VIDBEE_DOWNLOAD_DIR,
        ),
        proxy: normalize(process.env.OMNIAGENT_VIDBEE_PROXY),
        embedChapters: parseOptionalBoolean(
          process.env.OMNIAGENT_VIDBEE_EMBED_CHAPTERS,
        ),
        embedMetadata: parseOptionalBoolean(
          process.env.OMNIAGENT_VIDBEE_EMBED_METADATA,
        ),
        embedSubs: parseOptionalBoolean(
          process.env.OMNIAGENT_VIDBEE_EMBED_SUBS,
        ),
        embedThumbnail: parseOptionalBoolean(
          process.env.OMNIAGENT_VIDBEE_EMBED_THUMBNAIL,
        ),
      },
    },
  };
};
