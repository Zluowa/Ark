import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { authHint, withAuthHeaders } from "./_auth-headers.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const mossRoot = path.resolve(appRoot, "..", "..", "..");
const appBaseUrl =
  process.env.OMNIAGENT_APP_BASE_URL?.trim() || "http://127.0.0.1:3010";
const outDir =
  process.env.OMNIAGENT_VIDEO_SUBTITLE_OUTDIR?.trim() ||
  path.join(appRoot, "test-screenshots", "2026-03-10-video-subtitle-proof");
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

const uploadFile = async (localPath, scope = "video_subtitle_proof") => {
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
$synth.Speak('Ark video subtitle smoke test. Turn this local recording into transcript text, S R T, and V T T subtitles.');
$synth.Dispose();
`;
  await execFileAsync("powershell", ["-NoProfile", "-Command", script], {
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
};

const generateVideoWithSpeech = async (audioPath, targetPath) => {
  await execFileAsync(
    ffmpegPath,
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=1280x720:rate=12:duration=8",
      "-i",
      audioPath,
      "-shortest",
      "-pix_fmt",
      "yuv420p",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      targetPath,
    ],
    {
      windowsHide: true,
      maxBuffer: 50 * 1024 * 1024,
    },
  );
};

const requireText = (value, label) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} missing non-empty text`);
  }
  return value.trim();
};

const main = async () => {
  console.log(`[video-subtitle-proof] app=${appBaseUrl} ${authHint}`);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const audioPath = path.join(outDir, "sample-video-subtitle.wav");
  const videoPath = path.join(outDir, "sample-video-subtitle.mp4");

  await synthesizeSpeech(audioPath);
  await generateVideoWithSpeech(audioPath, videoPath);

  const videoUrl = await uploadFile(videoPath);
  const execution = await executeTool("video.transcribe_subtitle", {
    file_url: videoUrl,
    language: "en-US",
  });

  const result = execution.result ?? {};
  const transcript = requireText(result.transcript, "transcript");
  const txtText = requireText(result.txt_text, "txt_text");
  const srtText = requireText(result.srt_text, "srt_text");
  const vttText = requireText(result.vtt_text, "vtt_text");
  const bundleUrl = requireText(result.output_file_url, "output_file_url");

  if (!txtText.includes(transcript.split(/\s+/)[0] ?? "")) {
    throw new Error("txt_text does not include transcript content");
  }
  if (!/\d+\s*\n\d{2}:\d{2}:\d{2},\d{3}\s+-->\s+\d{2}:\d{2}:\d{2},\d{3}/.test(srtText)) {
    throw new Error("srt_text missing valid timestamp rows");
  }
  if (!/^WEBVTT/m.test(vttText) || !/-->/m.test(vttText)) {
    throw new Error("vtt_text missing WEBVTT structure");
  }
  if (!Array.isArray(result.artifacts) || result.artifacts.length < 4) {
    throw new Error("artifacts metadata missing expected entries");
  }

  const report = {
    generatedAt: new Date().toISOString(),
    appBaseUrl,
    authHint,
    upload: { videoUrl },
    subtitle: {
      transcript,
      txtText,
      srtPreview: srtText.split(/\r?\n/g).slice(0, 6).join("\n"),
      vttPreview: vttText.split(/\r?\n/g).slice(0, 6).join("\n"),
      bundleUrl,
      provider: result.provider,
      durationMs: result.duration_ms,
      artifactKinds: Array.isArray(result.artifacts)
        ? result.artifacts.map((item) => item?.kind).filter(Boolean)
        : [],
      segmentCount: Array.isArray(result.segments) ? result.segments.length : 0,
    },
  };

  await writeFile(
    path.join(outDir, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );

  console.log("[video-subtitle-proof] ok");
  console.log(`[video-subtitle-proof] transcript: ${transcript}`);
  console.log(`[video-subtitle-proof] bundle: ${bundleUrl}`);
};

main().catch((error) => {
  console.error(
    `[video-subtitle-proof] failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
