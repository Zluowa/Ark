import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = process.cwd();
const baseUrl =
  process.env.ARK_BASE_URL ??
  process.env.OMNIAGENT_APP_BASE_URL ??
  "http://127.0.0.1:3010";
const apiKey =
  process.env.ARK_API_KEY?.trim() ||
  process.env.OMNIAGENT_API_KEY?.trim() ||
  "";

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const spawnServer = () =>
  spawn(process.execPath, [resolve(root, "mcp/ark-mcp-server.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      ARK_BASE_URL: baseUrl,
      ...(apiKey ? { ARK_API_KEY: apiKey } : {}),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

const encodeMessage = (message) => {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8"),
    body,
  ]);
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

const createClient = (child) => {
  let buffer = Buffer.alloc(0);
  let nextId = 1;
  const pending = new Map();

  const rejectPending = (error) => {
    for (const value of pending.values()) {
      value.reject(error);
    }
    pending.clear();
  };

  const drain = () => {
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) {
        return;
      }
      const headers = parseHeaders(buffer.slice(0, headerEnd).toString("utf8"));
      const contentLength = Number(headers.get("content-length"));
      if (!Number.isFinite(contentLength) || contentLength < 0) {
        rejectPending(new Error("Invalid MCP frame header"));
        return;
      }
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;
      if (buffer.length < bodyEnd) {
        return;
      }
      const payload = buffer.slice(bodyStart, bodyEnd).toString("utf8");
      buffer = buffer.slice(bodyEnd);
      const message = JSON.parse(payload);
      if (message.id !== undefined && pending.has(message.id)) {
        const item = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) {
          item.reject(
            new Error(
              `${message.error.code ?? "mcp_error"}: ${
                message.error.message ?? "Unknown MCP error"
              }`,
            ),
          );
        } else {
          item.resolve(message.result);
        }
      }
    }
  };

  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    try {
      drain();
    } catch (error) {
      rejectPending(error instanceof Error ? error : new Error(String(error)));
    }
  });

  child.stderr.on("data", (chunk) => {
    const message = chunk.toString().trim();
    if (message) {
      process.stderr.write(`[mcp-smoke:stderr] ${message}\n`);
    }
  });

  child.on("error", (error) => {
    rejectPending(error);
  });

  child.on("exit", (code) => {
    if (code === 0) {
      return;
    }
    rejectPending(new Error(`MCP server exited with code ${code}`));
  });

  const request = (method, params = {}) =>
    new Promise((resolvePromise, rejectPromise) => {
      const id = nextId++;
      pending.set(id, {
        resolve: resolvePromise,
        reject: rejectPromise,
      });
      child.stdin.write(
        encodeMessage({
          jsonrpc: "2.0",
          id,
          method,
          params,
        }),
      );
    });

  const notify = (method, params = {}) => {
    child.stdin.write(
      encodeMessage({
        jsonrpc: "2.0",
        method,
        params,
      }),
    );
  };

  return { request, notify };
};

const main = async () => {
  const server = spawnServer();
  const client = createClient(server);

  try {
    const initialize = await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "ark-mcp-smoke",
        version: "0.1.0",
      },
    });
    assert(
      initialize?.serverInfo?.name === "ark-mcp-server",
      "initialize should return Ark MCP server info",
    );

    client.notify("notifications/initialized");

    const listed = await client.request("tools/list");
    assert(Array.isArray(listed?.tools), "tools/list should return an array");
    assert(listed.tools.length > 0, "tools/list should expose at least one tool");
    const jsonFormatTool = listed.tools.find((tool) => tool?.name === "convert.json_format");
    assert(jsonFormatTool, "MCP tool catalog should include convert.json_format");
    assert(
      jsonFormatTool?.inputSchema?.properties?.input,
      "convert.json_format should expose inputSchema properties",
    );

    const call = await client.request("tools/call", {
      name: "convert.json_format",
      arguments: {
        input: "{\"ok\":true}",
        mode: "pretty",
      },
    });
    assert(
      call?.isError !== true,
      `tools/call should not report isError: ${call?.content?.[0]?.text ?? "unknown error"}`,
    );
    assert(
      call?.structuredContent?.status === "success",
      "tools/call should return a successful structuredContent payload",
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          baseUrl,
          toolTotal: listed.tools.length,
          sampleTool: jsonFormatTool.name,
          callStatus: call.structuredContent.status,
        },
        null,
        2,
      ),
    );
  } finally {
    server.kill();
  }
};

main().catch((error) => {
  console.error(
    "[mcp-smoke] FAIL",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
