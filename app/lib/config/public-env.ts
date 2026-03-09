const normalizeApiPath = (value: string | undefined): string => {
  if (!value) {
    return "/api/chat";
  }

  return value.startsWith("/") ? value : `/${value}`;
};

export const publicEnv = {
  apiKey: process.env.NEXT_PUBLIC_OMNIAGENT_API_KEY?.trim(),
  chatApiPath: normalizeApiPath(process.env.NEXT_PUBLIC_CHAT_API_PATH),
  controlPlaneBaseUrl: process.env.NEXT_PUBLIC_CONTROL_PLANE_BASE_URL?.trim(),
} as const;
