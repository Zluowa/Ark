import fs from "node:fs";
import path from "node:path";
import { authHint, withAuthHeaders } from "./_auth-headers.mjs";

const appBaseUrl =
  process.env.OMNIAGENT_APP_BASE_URL ?? "http://127.0.0.1:3010";

const sleep = async (ms) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const ensureOk = async (res, label) => {
  if (res.ok) return;
  const body = await res.text();
  throw new Error(`${label} failed (${res.status}): ${body.slice(0, 400)}`);
};

const resolveFixture = (name) => {
  const candidates = [
    path.resolve(process.cwd(), "..", "..", "..", "..", name),
    path.resolve(process.cwd(), "..", "..", "..", name),
    path.resolve(process.cwd(), "..", "..", name),
    path.resolve(process.cwd(), "..", name),
    path.resolve(process.cwd(), name),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`Missing fixture file: ${name}`);
  }
  return found;
};

const uploadFile = async (filePath, contentType) => {
  const bytes = fs.readFileSync(filePath);
  const form = new FormData();
  form.append(
    "files",
    new Blob([bytes], { type: contentType }),
    path.basename(filePath),
  );
  form.append("scope", "tools_smoke_async");
  const uploadRes = await fetch(`${appBaseUrl}/api/v1/files`, {
    method: "POST",
    headers: withAuthHeaders(),
    body: form,
  });
  await ensureOk(uploadRes, `upload ${path.basename(filePath)}`);
  const uploadBody = await uploadRes.json();
  const file = uploadBody?.files?.[0];
  const url = String(file?.executor_url || file?.url || "").trim();
  if (!url) {
    throw new Error(`Upload missing url: ${path.basename(filePath)}`);
  }
  return url.startsWith("http") ? url : `${appBaseUrl}${url}`;
};

const pollJobUntilTerminal = async (jobId, timeoutMs = 60000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const res = await fetch(`${appBaseUrl}/api/v1/jobs/${jobId}`, {
      method: "GET",
      cache: "no-store",
      headers: withAuthHeaders(),
    });
    await ensureOk(res, `GET /api/v1/jobs/${jobId}`);
    const body = await res.json();
    const status = body?.status;
    if (
      status === "completed" ||
      status === "failed" ||
      status === "cancelled"
    ) {
      return body;
    }
    await sleep(250);
  }

  throw new Error(`Job timeout: ${jobId}`);
};

const main = async () => {
  console.log(`[tools-async-smoke] app=${appBaseUrl} ${authHint}`);

  const listRes = await fetch(`${appBaseUrl}/api/v1/tools?limit=200`, {
    method: "GET",
    cache: "no-store",
    headers: withAuthHeaders(),
  });
  await ensureOk(listRes, "GET /api/v1/tools");
  const list = await listRes.json();
  const available = new Set(
    (Array.isArray(list?.tools) ? list.tools : [])
      .map((tool) => (typeof tool?.id === "string" ? tool.id : ""))
      .filter(Boolean),
  );

  const requiredTools = [
    "convert.json_format",
    "image.convert",
    "audio.convert",
    "video.extract_audio",
  ];
  const missing = requiredTools.filter((toolId) => !available.has(toolId));
  if (missing.length > 0) {
    throw new Error(`Missing required async tools: ${missing.join(", ")}`);
  }

  const imageUrl = await uploadFile(resolveFixture("tmp_image.png"), "image/png");
  const audioUrl = await uploadFile(resolveFixture("tmp_audio.wav"), "audio/wav");
  const videoUrl = await uploadFile(resolveFixture("tmp_video.mp4"), "video/mp4");

  const cases = [
    {
      tool: "convert.json_format",
      params: { input: '{"foo":1,"bar":{"ok":true}}' },
    },
    {
      tool: "image.convert",
      params: { file_url: imageUrl, format: "webp" },
    },
    {
      tool: "audio.convert",
      params: { file_url: audioUrl, format: "mp3" },
    },
    {
      tool: "video.extract_audio",
      params: { file_url: videoUrl, format: "mp3" },
    },
  ];

  let completed = 0;
  for (const item of cases) {
    const enqueueRes = await fetch(`${appBaseUrl}/api/v1/execute/async`, {
      method: "POST",
      headers: withAuthHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ tool: item.tool, params: item.params }),
    });
    await ensureOk(enqueueRes, `POST /api/v1/execute/async (${item.tool})`);
    const enqueueBody = await enqueueRes.json();
    const jobId = enqueueBody?.job_id;
    if (typeof jobId !== "string" || !jobId) {
      throw new Error(`Missing job_id for tool: ${item.tool}`);
    }

    const terminal = await pollJobUntilTerminal(jobId, 60000);
    if (terminal?.status !== "completed") {
      throw new Error(
        `Async tool failed: ${item.tool}, status=${String(terminal?.status)}`,
      );
    }

    console.log(`[tools-async-smoke] ${item.tool} -> completed`);
    completed += 1;
  }

  console.log(`[tools-async-smoke] PASS (${completed}/${cases.length})`);
};

main().catch((error) => {
  console.error(
    "[tools-async-smoke] FAIL",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
