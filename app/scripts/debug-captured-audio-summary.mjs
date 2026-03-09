import { readFile } from "node:fs/promises";
import path from "node:path";
import { authHint, withAuthHeaders } from "./_auth-headers.mjs";

const filePath = process.argv[2];
if (!filePath) {
  console.error("usage: node app/scripts/debug-captured-audio-summary.mjs <wav-path>");
  process.exit(1);
}

const appBaseUrl =
  process.env.OMNIAGENT_APP_BASE_URL?.trim() || "http://127.0.0.1:3010";

const ensureOk = async (res, label) => {
  if (res.ok) return;
  const body = await res.text();
  throw new Error(`${label} failed (${res.status}): ${body.slice(0, 1200)}`);
};

const uploadFile = async (localPath) => {
  const buffer = await readFile(localPath);
  const form = new FormData();
  form.append("files", new Blob([buffer]), path.basename(localPath));
  form.append("scope", "capture_audio_debug");

  const res = await fetch(`${appBaseUrl}/api/v1/files`, {
    method: "POST",
    headers: withAuthHeaders(),
    body: form,
  });
  await ensureOk(res, "upload");
  const payload = await res.json();
  const first = Array.isArray(payload?.files) ? payload.files[0] : undefined;
  return first?.executor_url || first?.url || "";
};

const executeTool = async (tool, params) => {
  const res = await fetch(`${appBaseUrl}/api/v1/execute`, {
    method: "POST",
    headers: withAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ tool, params }),
  });
  await ensureOk(res, `execute ${tool}`);
  return res.json();
};

const main = async () => {
  console.log(`[debug-captured-audio-summary] app=${appBaseUrl} ${authHint}`);
  const fileUrl = await uploadFile(filePath);
  if (!fileUrl) {
    throw new Error("upload missing executor url");
  }
  const payload = await executeTool("audio.transcribe_summary", {
    file_url: fileUrl,
    language: "en-US",
    note_hint: "Debug captured audio from native island",
  });
  console.log(JSON.stringify(payload, null, 2));
};

main().catch((error) => {
  console.error(
    `[debug-captured-audio-summary] failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
