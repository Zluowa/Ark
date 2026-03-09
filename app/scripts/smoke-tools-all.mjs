import fs from "node:fs";
import path from "node:path";
import { authHint, withAuthHeaders } from "./_auth-headers.mjs";

const appBaseUrl =
  process.env.OMNIAGENT_APP_BASE_URL ?? "http://127.0.0.1:3010";

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
  form.append("scope", "tools_smoke_all");
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

const findUrlRecursive = (value) => {
  if (!value) return "";
  if (typeof value === "string") {
    if (
      value.startsWith("http://") ||
      value.startsWith("https://") ||
      value.startsWith("/api/")
    ) {
      return value;
    }
    return "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findUrlRecursive(item);
      if (found) return found;
    }
    return "";
  }
  if (typeof value === "object") {
    for (const key of [
      "output_file_url",
      "output_url",
      "download_url",
      "file_url",
      "url",
    ]) {
      const direct = findUrlRecursive(value[key]);
      if (direct) return direct;
    }
    for (const nested of Object.values(value)) {
      const found = findUrlRecursive(nested);
      if (found) return found;
    }
  }
  return "";
};

const verifyDownload = async (url, label) => {
  if (!url) {
    throw new Error(`${label} missing output url`);
  }
  const full = url.startsWith("http") ? url : `${appBaseUrl}${url}`;
  const res = await fetch(full, { headers: withAuthHeaders() });
  await ensureOk(res, `${label} download`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength <= 0) {
    throw new Error(`${label} output is empty`);
  }
};

const main = async () => {
  console.log(`[tools-smoke] app=${appBaseUrl} ${authHint}`);

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
    "image.compress",
    "audio.convert",
    "video.convert",
    "video.extract_audio",
    "video.trim",
  ];
  const missing = requiredTools.filter((toolId) => !available.has(toolId));
  if (missing.length > 0) {
    throw new Error(`Missing required tools: ${missing.join(", ")}`);
  }

  const imageUrl = await uploadFile(resolveFixture("tmp_image.png"), "image/png");
  const audioUrl = await uploadFile(resolveFixture("tmp_audio.wav"), "audio/wav");
  const videoUrl = await uploadFile(resolveFixture("tmp_video.mp4"), "video/mp4");

  const cases = [
    {
      tool: "convert.json_format",
      params: { input: '{"foo":1,"bar":{"ok":true}}' },
      verifyFile: false,
    },
    {
      tool: "image.convert",
      params: { file_url: imageUrl, format: "webp" },
      verifyFile: true,
    },
    {
      tool: "image.compress",
      params: { file_url: imageUrl, quality: 80 },
      verifyFile: true,
    },
    {
      tool: "audio.convert",
      params: { file_url: audioUrl, format: "mp3" },
      verifyFile: true,
    },
    {
      tool: "video.convert",
      params: { file_url: videoUrl, format: "mp4" },
      verifyFile: true,
    },
    {
      tool: "video.extract_audio",
      params: { file_url: videoUrl, format: "mp3" },
      verifyFile: true,
    },
    {
      tool: "video.trim",
      params: { file_url: videoUrl, start: "0", end: "1" },
      verifyFile: true,
    },
  ];

  let passed = 0;
  for (const item of cases) {
    const executeRes = await fetch(`${appBaseUrl}/api/v1/execute`, {
      method: "POST",
      headers: withAuthHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        tool: item.tool,
        params: item.params,
      }),
    });
    await ensureOk(executeRes, `POST /api/v1/execute (${item.tool})`);
    const output = await executeRes.json();
    if (output?.status !== "success") {
      throw new Error(`Tool execution not successful: ${item.tool}`);
    }
    if (item.verifyFile) {
      const outputUrl = findUrlRecursive(output?.result);
      await verifyDownload(outputUrl, item.tool);
    }
    passed += 1;
    console.log(`[tools-smoke] ${item.tool} -> success`);
  }

  console.log(`[tools-smoke] PASS (${passed}/${cases.length})`);
};

main().catch((error) => {
  console.error(
    "[tools-smoke] FAIL",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
