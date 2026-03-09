import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { authHint, withAuthHeaders } from "./_auth-headers.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const mossRoot = path.resolve(appRoot, "..", "..", "..");
const appBaseUrl =
  process.env.OMNIAGENT_APP_BASE_URL?.trim() || "http://127.0.0.1:3010";
const outDir =
  process.env.OMNIAGENT_CAPTURE_AI_OUTDIR?.trim() ||
  path.join(appRoot, "test-screenshots", "2026-03-08-capture-ai-proof");
const ffmpegPath = path.join(
  mossRoot,
  "tools",
  "ffmpeg",
  "ffmpeg-8.0.1-essentials_build",
  "bin",
  "ffmpeg.exe",
);

const ensureOk = async (res, label) => {
  if (res.ok) return;
  const body = await res.text();
  throw new Error(`${label} failed (${res.status}): ${body.slice(0, 1000)}`);
};

const uploadFile = async (localPath, scope = "capture_ai_proof") => {
  const buffer = await readFile(localPath);
  const form = new FormData();
  form.append("files", new Blob([buffer]), path.basename(localPath));
  form.append("scope", scope);

  const res = await fetch(`${appBaseUrl}/api/v1/files`, {
    method: "POST",
    headers: withAuthHeaders(),
    body: form,
  });
  await ensureOk(res, `upload ${path.basename(localPath)}`);
  const payload = await res.json();
  const first = Array.isArray(payload?.files) ? payload.files[0] : undefined;
  const url =
    typeof first?.executor_url === "string" && first.executor_url.trim()
      ? first.executor_url.trim()
      : typeof first?.url === "string" && first.url.trim()
        ? first.url.trim()
        : "";
  if (!url) {
    throw new Error(`upload missing file url for ${localPath}`);
  }
  return url;
};

const executeTool = async (tool, params) => {
  const res = await fetch(`${appBaseUrl}/api/v1/execute`, {
    method: "POST",
    headers: withAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ tool, params }),
  });
  await ensureOk(res, `execute ${tool}`);
  const payload = await res.json();
  if (payload?.status !== "success") {
    throw new Error(
      `tool ${tool} did not succeed: ${JSON.stringify(payload).slice(0, 1000)}`,
    );
  }
  return payload;
};

const synthesizeSpeech = async (targetPath) => {
  const script = `
Add-Type -AssemblyName System.Speech;
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;
$synth.Rate = -2;
$synth.SetOutputToWaveFile('${targetPath.replace(/\\/g, "\\\\")}');
$synth.Speak('Omni agent audio note test. Summarize the short recording.');
$synth.Dispose();
`;
  await execFileAsync("powershell", ["-NoProfile", "-Command", script], {
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
};

const generateVideo = async (targetPath) => {
  const { stderr } = await execFileAsync(
    ffmpegPath,
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=1280x720:rate=12:duration=4",
      "-pix_fmt",
      "yuv420p",
      targetPath,
    ],
    {
      windowsHide: true,
      maxBuffer: 50 * 1024 * 1024,
    },
  );
  return stderr;
};

const requireText = (value, label) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} missing non-empty text`);
  }
  return value.trim();
};

const main = async () => {
  console.log(`[capture-ai-proof] app=${appBaseUrl} ${authHint}`);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const audioPath = path.join(outDir, "sample-audio-note.wav");
  const videoPath = path.join(outDir, "sample-screen-record.mp4");

  await synthesizeSpeech(audioPath);
  await generateVideo(videoPath);

  const [audioUrl, videoUrl] = await Promise.all([
    uploadFile(audioPath),
    uploadFile(videoPath),
  ]);

  const audioExec = await executeTool("audio.transcribe_summary", {
    file_url: audioUrl,
    language: "en-US",
    note_hint: "Local smoke proof for Audio Notes",
  });
  const transcriptExec = await executeTool("audio.transcribe_text", {
    file_url: audioUrl,
    language: "en-US",
  });
  const videoExec = await executeTool("video.analyze_summary", {
    file_url: videoUrl,
    prompt: "Local smoke proof clip generated from ffmpeg testsrc.",
  });

  const audioResult = audioExec.result ?? {};
  const transcriptResult = transcriptExec.result ?? {};
  const videoResult = videoExec.result ?? {};
  const transcript = requireText(audioResult.transcript, "audio transcript");
  const transcriptText = requireText(transcriptResult.text, "audio transcript text");
  const audioSummary = requireText(audioResult.summary, "audio summary");
  const audioReportMarkdown = requireText(
    audioResult.report_markdown,
    "audio report markdown",
  );
  const videoAnalysis = requireText(videoResult.analysis, "video analysis");
  const videoSummary = requireText(videoResult.summary, "video summary");
  const videoReportMarkdown = requireText(
    videoResult.report_markdown,
    "video report markdown",
  );
  if (!audioReportMarkdown.includes("## Overview")) {
    throw new Error("audio report markdown missing overview section");
  }
  if (!audioReportMarkdown.includes("## Transcript")) {
    throw new Error("audio report markdown missing transcript section");
  }
  if (!transcriptText.includes(transcript.split(/\s+/)[0] ?? "")) {
    throw new Error("audio transcript text output does not contain transcript content");
  }
  if (!videoReportMarkdown.includes("## Overview")) {
    throw new Error("video report markdown missing overview section");
  }
  if (!videoReportMarkdown.includes("## Visual Analysis")) {
    throw new Error("video report markdown missing visual analysis section");
  }
  if (
    /stop (the )?screen recording/i.test(videoSummary) ||
    /stop (the )?screen recording/i.test(videoReportMarkdown)
  ) {
    throw new Error("video summary regressed to stale stop-recording guidance");
  }

  const report = {
    generatedAt: new Date().toISOString(),
    appBaseUrl,
    authHint,
    uploads: { audioUrl, videoUrl },
    audio: {
      transcript,
      transcriptText,
      summary: audioSummary,
      reportMarkdown: audioReportMarkdown,
      provider: audioResult.provider,
      durationMs: audioResult.duration_ms,
    },
    video: {
      analysis: videoAnalysis,
      summary: videoSummary,
      reportMarkdown: videoReportMarkdown,
      provider: videoResult.provider,
      model: videoResult.model,
      durationSeconds: videoResult.duration_seconds,
    },
  };

  await writeFile(
    path.join(outDir, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );

  console.log("[capture-ai-proof] ok");
  console.log(`[capture-ai-proof] audio summary: ${audioSummary}`);
  console.log(`[capture-ai-proof] video summary: ${videoSummary}`);
};

main().catch((error) => {
  console.error(
    `[capture-ai-proof] failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
