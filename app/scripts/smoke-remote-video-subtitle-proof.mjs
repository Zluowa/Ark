import path from "node:path";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { authHint, withAuthHeaders } from "./_auth-headers.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const mossRoot = path.resolve(appRoot, "..", "..", "..");
const appBaseUrl =
  process.env.OMNIAGENT_APP_BASE_URL?.trim() || "http://127.0.0.1:3010";
const outDir =
  process.env.OMNIAGENT_REMOTE_VIDEO_SUBTITLE_OUTDIR?.trim() ||
  path.join(appRoot, "test-screenshots", "2026-03-10-remote-video-subtitle-proof");
const ffmpegPath = path.join(
  mossRoot,
  "tools",
  "ffmpeg",
  "ffmpeg-8.0.1-essentials_build",
  "bin",
  "ffmpeg.exe",
);
const hasXhsEnvCredential = Boolean(
  process.env.OMNIAGENT_XHS_COOKIE?.trim() || process.env.XHS_COOKIE?.trim(),
);

const cases = [
  {
    id: "bilibili",
    url: "https://www.bilibili.com/video/BV1m34y1F7fD/",
    language: "zh-Hans",
  },
  {
    id: "youtube",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    language: "en",
  },
  {
    id: "douyin",
    url:
      process.env.OMNIAGENT_DOUYIN_SUBTITLE_URL?.trim() ||
      "https://www.iesdouyin.com/share/video/6941975668934610176/",
    language: "zh-Hans",
  },
  {
    id: "direct",
    url: process.env.OMNIAGENT_DIRECT_VIDEO_URL?.trim() || "",
    language: "en",
  },
  {
    id: "xiaohongshu",
    url:
      process.env.OMNIAGENT_XHS_SUBTITLE_URL?.trim() ||
      "https://www.xiaohongshu.com/explore/63ef04f10000000012031740",
    language: "zh-Hans",
    optional: !hasXhsEnvCredential,
  },
];

const ensureOk = async (res, label) => {
  if (res.ok) return;
  const body = await res.text();
  throw new Error(`${label} failed (${res.status}): ${body.slice(0, 1000)}`);
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

const requireText = (value, label) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} missing non-empty text`);
  }
  return value.trim();
};

const downloadArtifact = async (url, label) => {
  const absolute = /^https?:\/\//i.test(url) ? url : `${appBaseUrl}${url}`;
  const res = await fetch(absolute, { headers: withAuthHeaders() });
  await ensureOk(res, `download ${label}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length <= 0) {
    throw new Error(`${label} artifact download was empty`);
  }
  return { url: absolute, bytes: buffer.length };
};

const classifyBoundary = (error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (/xhs_auth_required/i.test(message)) {
    return {
      code: "auth_required",
      message,
    };
  }
  if (/xhs_bridge_unavailable/i.test(message)) {
    return {
      code: "bridge_unavailable",
      message,
    };
  }
  return {
    code: "execution_failed",
    message,
  };
};

const synthesizeSpeech = async (targetPath) => {
  const script = `
Add-Type -AssemblyName System.Speech;
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;
$synth.Rate = -2;
$synth.SetOutputToWaveFile('${targetPath.replace(/\\/g, "\\\\")}');
$synth.Speak('Ark remote subtitle smoke test. This direct downloadable video should produce transcript text, S R T, and V T T subtitles.');
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
      "testsrc=size=960x540:rate=12:duration=7",
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

const createDirectVideoServer = async (videoPath) =>
  await new Promise((resolvePromise, rejectPromise) => {
    const server = createServer(async (_req, res) => {
      try {
        const buffer = await readFile(videoPath);
        res.writeHead(200, {
          "Content-Type": "video/mp4",
          "Content-Length": String(buffer.length),
          "Cache-Control": "no-store",
        });
        res.end(buffer);
      } catch (error) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(error instanceof Error ? error.message : String(error));
      }
    });
    server.on("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        rejectPromise(new Error("Failed to reserve direct video smoke port."));
        return;
      }
      resolvePromise({
        url: `http://127.0.0.1:${address.port}/direct-video.mp4`,
        close: () =>
          new Promise((resolveClose) => {
            server.close(() => resolveClose(undefined));
          }),
      });
    });
  });

const main = async () => {
  console.log(`[remote-video-subtitle-proof] app=${appBaseUrl} ${authHint}`);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const report = {
    generatedAt: new Date().toISOString(),
    appBaseUrl,
    authHint,
    deployment: {
      xhsBridgeUrl:
        process.env.OMNIAGENT_XHS_BRIDGE_URL?.trim() || "http://127.0.0.1:5556",
      hasXhsEnvCredential,
    },
    cases: {},
  };

  let directServer;
  try {
    if (!cases.find((item) => item.id === "direct")?.url) {
      const directAudioPath = path.join(outDir, "direct-remote-subtitle.wav");
      const directVideoPath = path.join(outDir, "direct-remote-subtitle.mp4");
      await synthesizeSpeech(directAudioPath);
      await generateVideoWithSpeech(directAudioPath, directVideoPath);
      directServer = await createDirectVideoServer(directVideoPath);
      const directCase = cases.find((item) => item.id === "direct");
      if (directCase) {
        directCase.url = directServer.url;
      }
    }

    for (const item of cases) {
      try {
        const execution = await executeTool("media.extract_subtitle", {
          url: item.url,
          language: item.language,
        });
        const result = execution.result ?? {};
        const txtText = requireText(result.txt_text, `${item.id} txt_text`);
        const srtText = requireText(result.srt_text, `${item.id} srt_text`);
        const vttText = requireText(result.vtt_text, `${item.id} vtt_text`);
        const bundleUrl = requireText(result.output_file_url, `${item.id} output_file_url`);
        const platform = requireText(result.platform, `${item.id} platform`);

        if (!/\d+\s*\n\d{2}:\d{2}:\d{2},\d{3}\s+-->\s+\d{2}:\d{2}:\d{2},\d{3}/.test(srtText)) {
          throw new Error(`${item.id} srt_text missing valid timestamps`);
        }
        if (!/^WEBVTT/m.test(vttText) || !/-->/m.test(vttText)) {
          throw new Error(`${item.id} vtt_text missing WEBVTT structure`);
        }
        if (!txtText.trim()) {
          throw new Error(`${item.id} txt_text was empty`);
        }

        report.cases[item.id] = {
          status: "ok",
          url: item.url,
          language: item.language,
          platform,
          subtitleSource: result.subtitle_source,
          totalEntries: result.total_entries,
          txtPreview: txtText.slice(0, 160),
          srtPreview: srtText.split(/\r?\n/g).slice(0, 4).join("\n"),
          vttPreview: vttText.split(/\r?\n/g).slice(0, 4).join("\n"),
          artifact: await downloadArtifact(bundleUrl, `${item.id} subtitle bundle`),
        };
      } catch (error) {
        if (!item.optional) {
          throw error;
        }
        const boundary = classifyBoundary(error);
        report.cases[item.id] = {
          status: "blocked",
          url: item.url,
          language: item.language,
          boundary_code: boundary.code,
          reason: boundary.message,
        };
      }
    }

    await writeFile(
      path.join(outDir, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
  } finally {
    if (directServer) {
      await directServer.close();
    }
  }

  console.log("[remote-video-subtitle-proof] ok");
  console.log(
    `[remote-video-subtitle-proof] cases=${Object.keys(report.cases).join(",")}`,
  );
};

main().catch((error) => {
  console.error(
    `[remote-video-subtitle-proof] failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
