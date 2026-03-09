// @input: params.message string
// @output: ExecuteResult with echoed message
// @position: Sample echo tool demonstrating v5 engine registration

import type { ToolManifest, ToolHandler } from "../types";

export const manifest: ToolManifest = {
  id: "util.echo",
  name: "Echo",
  description: "Echoes back the provided message. Useful for testing.",
  category: "generate",
  tags: ["utility", "debug", "test"],
  params: [
    {
      name: "message",
      type: "string",
      required: true,
      description: "The message to echo back",
    },
  ],
  output_type: "json",
  keywords: ["echo", "repeat", "test", "ping"],
  patterns: ["^echo\\s+", "repeat this", "say back"],
};

export const handler: ToolHandler = async (params) => {
  const message = String(params.message ?? "");
  return {
    status: "success",
    output: { message, echoed_at: new Date().toISOString() },
    duration_ms: 1,
  };
};
