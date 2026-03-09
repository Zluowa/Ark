// @input: UI provider ids or API provider ids
// @output: canonical provider mappings shared by frontend and API routes
// @position: shared constants for connection identity normalization

export const UI_CONNECTION_PROVIDERS = [
  "gmail",
  "google-drive",
  "slack",
  "notion",
  "feishu",
  "dingtalk",
  "wechat-work",
  "alipay",
  "netease",
  "xiaohongshu",
] as const;

export type UiConnectionProvider = (typeof UI_CONNECTION_PROVIDERS)[number];

export const API_CONNECTION_PROVIDERS = [
  "gmail",
  "google-drive",
  "slack",
  "notion",
  "feishu",
  "dingtalk",
  "wechat-work",
  "alipay",
  "netease",
  "xhs",
] as const;

export type ApiConnectionProvider = (typeof API_CONNECTION_PROVIDERS)[number];

const UI_TO_API_PROVIDER: Record<UiConnectionProvider, ApiConnectionProvider> =
  {
    gmail: "gmail",
    "google-drive": "google-drive",
    slack: "slack",
    notion: "notion",
    feishu: "feishu",
    dingtalk: "dingtalk",
    "wechat-work": "wechat-work",
    alipay: "alipay",
    netease: "netease",
    xiaohongshu: "xhs",
  };

const API_TO_UI_PROVIDER: Record<ApiConnectionProvider, UiConnectionProvider> =
  {
    gmail: "gmail",
    "google-drive": "google-drive",
    slack: "slack",
    notion: "notion",
    feishu: "feishu",
    dingtalk: "dingtalk",
    "wechat-work": "wechat-work",
    alipay: "alipay",
    netease: "netease",
    xhs: "xiaohongshu",
  };

export const isUiConnectionProvider = (
  provider: string,
): provider is UiConnectionProvider =>
  Object.prototype.hasOwnProperty.call(UI_TO_API_PROVIDER, provider);

export const isApiConnectionProvider = (
  provider: string,
): provider is ApiConnectionProvider =>
  Object.prototype.hasOwnProperty.call(API_TO_UI_PROVIDER, provider);

export const toApiConnectionProvider = (
  provider: UiConnectionProvider,
): ApiConnectionProvider => UI_TO_API_PROVIDER[provider];

export const toUiConnectionProvider = (
  provider: ApiConnectionProvider,
): UiConnectionProvider => API_TO_UI_PROVIDER[provider];

export const normalizeConnectionProvider = (
  provider: string,
): ApiConnectionProvider | undefined => {
  if (isApiConnectionProvider(provider)) return provider;
  if (provider === "xiaohongshu") return "xhs";
  return undefined;
};
