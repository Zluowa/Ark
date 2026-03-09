const configuredApiKey =
  process.env.OMNIAGENT_API_KEY?.trim() ||
  process.env.OMNIAGENT_TEST_API_KEY?.trim() ||
  "";

export const withAuthHeaders = (headers = {}) => {
  if (!configuredApiKey) {
    return headers;
  }
  return {
    ...headers,
    "X-API-Key": configuredApiKey,
  };
};

export const authHint = configuredApiKey ? "api-key:on" : "api-key:off";
