import process from "node:process";

const baseUrl =
  process.env.ARK_BASE_URL ??
  process.env.OMNIAGENT_APP_BASE_URL ??
  "http://127.0.0.1:3010";
const apiKey =
  process.env.ARK_API_KEY?.trim() ||
  process.env.OMNIAGENT_API_KEY?.trim() ||
  "";
const protocolVersionDefault = "2024-11-05";

let readBuffer = Buffer.alloc(0);
let cachedTools = null;

const writeMessage = (message) => {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write(
    Buffer.concat([
      Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8"),
      body,
    ]),
  );
};

const writeResponse = (id, result) => {
  writeMessage({
    jsonrpc: "2.0",
    id,
    result,
  });
};

const writeError = (id, code, message, data) => {
  writeMessage({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data !== undefined ? { data } : {}),
    },
  });
};

const parseHeaders = (headerBlock) => {
  const headers = new Map();
  for (const line of headerBlock.split("\r\n")) {
    const index = line.indexOf(":");
    if (index <= 0) {
      continue;
    }
    headers.set(
      line.slice(0, index).trim().toLowerCase(),
      line.slice(index + 1).trim(),
    );
  }
  return headers;
};

const readMessages = () => {
  while (true) {
    const headerEnd = readBuffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) {
      return;
    }
    const headerBlock = readBuffer.slice(0, headerEnd).toString("utf8");
    const headers = parseHeaders(headerBlock);
    const contentLength = Number(headers.get("content-length"));
    if (!Number.isFinite(contentLength) || contentLength < 0) {
      readBuffer = Buffer.alloc(0);
      return;
    }
    const messageStart = headerEnd + 4;
    const messageEnd = messageStart + contentLength;
    if (readBuffer.length < messageEnd) {
      return;
    }
    const payload = readBuffer.slice(messageStart, messageEnd).toString("utf8");
    readBuffer = readBuffer.slice(messageEnd);
    handlePayload(payload).catch((error) => {
      process.stderr.write(
        `[ark-mcp] request handling failed: ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      );
    });
  }
};

const requestJson = async (path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(apiKey ? { "X-API-Key": apiKey } : {}),
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = {};
  }
  if (!response.ok) {
    const error =
      body && typeof body === "object" && !Array.isArray(body)
        ? body.error
        : undefined;
    const message =
      error && typeof error.message === "string"
        ? error.message
        : `Ark API request failed: ${response.status}`;
    const code =
      error && typeof error.code === "string"
        ? error.code
        : "ark_api_error";
    const status = response.status;
    throw Object.assign(new Error(message), {
      code,
      details: error?.details,
      status,
    });
  }
  return body;
};

const toJsonSchema = (param) => {
  const schema = {
    type:
      param.type === "number"
        ? "number"
        : param.type === "boolean"
          ? "boolean"
          : "string",
    description: param.description,
  };
  if (param.type === "enum" && Array.isArray(param.enum_values)) {
    schema.type = "string";
    schema.enum = param.enum_values;
  }
  if (typeof param.min === "number") {
    schema.minimum = param.min;
  }
  if (typeof param.max === "number") {
    schema.maximum = param.max;
  }
  if (param.default !== undefined) {
    schema.default = param.default;
  }
  if (Array.isArray(param.accept) && param.accept.length > 0) {
    schema.description = `${schema.description} Accepted: ${param.accept.join(", ")}.`;
  }
  return schema;
};

const manifestToTool = (manifest) => ({
  name: manifest.id,
  description: `${manifest.name}. ${manifest.description}`.trim(),
  inputSchema: {
    type: "object",
    properties: Object.fromEntries(
      manifest.params.map((param) => [param.name, toJsonSchema(param)]),
    ),
    required: manifest.params
      .filter((param) => param.required)
      .map((param) => param.name),
    additionalProperties: true,
  },
});

const loadTools = async () => {
  if (cachedTools) {
    return cachedTools;
  }
  const listing = await requestJson("/api/v1/tools?limit=200");
  const summaries = Array.isArray(listing.tools) ? listing.tools : [];
  const details = await Promise.all(
    summaries.map(async (tool) => {
      const detail = await requestJson(
        `/api/v1/tools/${encodeURIComponent(tool.id)}`,
      );
      return detail?.tool?.manifest;
    }),
  );
  cachedTools = details
    .filter((manifest) => manifest && typeof manifest.id === "string")
    .map((manifest) => manifestToTool(manifest));
  return cachedTools;
};

const callTool = async (name, args) => {
  const result = await requestJson("/api/v1/execute", {
    method: "POST",
    body: JSON.stringify({
      tool: name,
      params: args && typeof args === "object" ? args : {},
    }),
  });
  const text =
    typeof result?.result === "string"
      ? result.result
      : JSON.stringify(result?.result ?? result, null, 2);
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
    structuredContent: result,
  };
};

const handleRequest = async (message) => {
  const { id, method, params } = message;
  switch (method) {
    case "initialize": {
      writeResponse(id, {
        protocolVersion:
          params && typeof params.protocolVersion === "string"
            ? params.protocolVersion
            : protocolVersionDefault,
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
        serverInfo: {
          name: "ark-mcp-server",
          version: "0.1.0",
        },
      });
      return;
    }
    case "ping": {
      writeResponse(id, {});
      return;
    }
    case "tools/list": {
      const tools = await loadTools();
      writeResponse(id, { tools });
      return;
    }
    case "tools/call": {
      if (!params || typeof params.name !== "string" || !params.name.trim()) {
        writeResponse(id, {
          content: [
            {
              type: "text",
              text: "Missing tool name.",
            },
          ],
          isError: true,
        });
        return;
      }
      try {
        const result = await callTool(params.name.trim(), params.arguments);
        writeResponse(id, result);
      } catch (error) {
        writeResponse(id, {
          content: [
            {
              type: "text",
              text:
                error instanceof Error ? error.message : "Tool call failed.",
            },
          ],
          isError: true,
        });
      }
      return;
    }
    case "resources/list":
      writeResponse(id, { resources: [] });
      return;
    case "prompts/list":
      writeResponse(id, { prompts: [] });
      return;
    default:
      writeError(id, -32601, `Method not found: ${method}`);
  }
};

const handleNotification = async (message) => {
  switch (message.method) {
    case "notifications/initialized":
    case "$/cancelRequest":
      return;
    default:
      return;
  }
};

const handlePayload = async (payload) => {
  let message;
  try {
    message = JSON.parse(payload);
  } catch {
    writeError(null, -32700, "Parse error");
    return;
  }
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    writeError(message?.id ?? null, -32600, "Invalid Request");
    return;
  }
  if (message.id === undefined) {
    await handleNotification(message);
    return;
  }
  await handleRequest(message);
};

process.stdin.on("data", (chunk) => {
  readBuffer = Buffer.concat([readBuffer, chunk]);
  readMessages();
});

process.stdin.on("end", () => {
  process.exit(0);
});

process.on("uncaughtException", (error) => {
  process.stderr.write(
    `[ark-mcp] uncaught exception: ${
      error instanceof Error ? error.stack ?? error.message : String(error)
    }\n`,
  );
  process.exit(1);
});

