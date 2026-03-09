// @input: assistant-ui runtime + Thread component + optional sessionStorage prefill prompt
// @output: Chat agent embedded in dashboard layout
// @position: /dashboard/agent — primary AI chat within dashboard shell

"use client";

import { useEffect } from "react";
import { AssistantRuntimeProvider, useComposerRuntime } from "@assistant-ui/react";
import { useChatRuntime, AssistantChatTransport } from "@assistant-ui/react-ai-sdk";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { Thread } from "@/components/assistant-ui/thread";
import { publicEnv } from "@/lib/config/public-env";

const PREFILL_KEY = "agent_prefill_prompt";

function PromptPrefill() {
  const composerRuntime = useComposerRuntime();
  useEffect(() => {
    const prompt = sessionStorage.getItem(PREFILL_KEY);
    if (!prompt) return;
    sessionStorage.removeItem(PREFILL_KEY);
    composerRuntime.setText(prompt);
  }, [composerRuntime]);
  return null;
}

export default function AgentPage() {
  const chatHeaders = publicEnv.apiKey
    ? { "X-API-Key": publicEnv.apiKey }
    : undefined;

  const runtime = useChatRuntime({
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    transport: new AssistantChatTransport({
      api: publicEnv.chatApiPath,
      headers: chatHeaders,
    }),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <PromptPrefill />
      <div className="flex h-full overflow-hidden">
        <div className="flex-1 overflow-hidden">
          <Thread />
        </div>
      </div>
    </AssistantRuntimeProvider>
  );
}
