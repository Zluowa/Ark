// @input: Server env config (relay / openai / anthropic)
// @output: Vercel AI SDK LanguageModel + metadata for chat route
// @position: Provider factory — auto-selects @ai-sdk/anthropic for Claude models

import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { getServerEnv } from "@/lib/server/env";

const asOpenAiBaseUrl = (url: string): string =>
  url.endsWith("/v1") ? url : `${url}/v1`;

const isClaudeModel = (model: string): boolean =>
  model.startsWith("claude-");

const parseThinkingModel = (model: string) => {
  const thinking = model.endsWith("-thinking");
  const baseModel = thinking ? model.replace(/-thinking$/, "") : model;
  return { baseModel, thinking };
};

export type ModelConfig = {
  model: ReturnType<typeof createAnthropic | typeof createOpenAI>;
  thinking: boolean;
};

export const createChatModel = () => {
  const env = getServerEnv();

  if (env.relayBaseUrl) {
    if (!env.relayApiKey) {
      throw new Error(
        "Missing relay key. Set OMNIAGENT_RELAY_API_KEY when using OMNIAGENT_RELAY_BASE_URL.",
      );
    }

    if (isClaudeModel(env.relayModel)) {
      const { baseModel, thinking } = parseThinkingModel(env.relayModel);
      const anthropicBase = env.relayBaseUrl.endsWith("/v1")
        ? env.relayBaseUrl
        : `${env.relayBaseUrl}/v1`;
      const provider = createAnthropic({
        apiKey: env.relayApiKey,
        baseURL: anthropicBase,
      });
      return { model: provider(baseModel), thinking };
    }

    const provider = createOpenAI({
      apiKey: env.relayApiKey,
      baseURL: asOpenAiBaseUrl(env.relayBaseUrl),
    });
    const model = env.relayProtocol === "chat"
      ? provider.chat(env.relayModel)
      : provider.responses(env.relayModel);
    return { model, thinking: false };
  }

  if (!env.openaiApiKey) {
    throw new Error(
      "Missing provider config. Set relay envs (OMNIAGENT_RELAY_BASE_URL + OMNIAGENT_RELAY_API_KEY) or OPENAI_API_KEY.",
    );
  }

  const provider = createOpenAI({
    apiKey: env.openaiApiKey,
    baseURL: env.openaiBaseUrl,
  });
  const model = env.openaiProtocol === "chat"
    ? provider.chat(env.openaiModel)
    : provider.responses(env.openaiModel);
  return { model, thinking: false };
};

/** @deprecated use createChatModel() */
export const createResponsesModel = () => createChatModel().model;
