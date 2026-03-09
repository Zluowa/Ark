import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outputDir = path.join(repoRoot, "app", "public", "demo");
mkdirSync(outputDir, { recursive: true });

const audioNotesFrames = [
  "desktop/test-screenshots/2026-03-08-island-capture-round/02-audio-notes-recording.png",
  "desktop/test-screenshots/2026-03-08-island-capture-round/03-audio-notes-file-ready.png",
  "desktop/test-screenshots/2026-03-08-island-capture-round/04-audio-notes-transcript-ready.png",
  "desktop/test-screenshots/2026-03-08-island-capture-round/05-audio-notes-ask-ai-input.png",
  "desktop/test-screenshots/2026-03-08-island-capture-round/06-audio-notes-ai-output.png",
];

const studioFrames = [
  "desktop/test-screenshots/2026-03-08-island-iopaint-polish-round/16-remove-watermark-02-preview.png",
  "desktop/test-screenshots/2026-03-08-island-iopaint-polish-round/16-remove-watermark-03-edit-open.png",
  "desktop/test-screenshots/2026-03-08-island-iopaint-polish-round/16-remove-watermark-03b-ready.png",
  "desktop/test-screenshots/2026-03-08-island-iopaint-polish-round/16-remove-watermark-04-processing.png",
  "desktop/test-screenshots/2026-03-08-island-iopaint-polish-round/16-remove-watermark-06-result-preview.png",
];

const neteaseFrames = [
  "desktop/test-screenshots/2026-03-09-island-netease-auth-round/01-stack-netease-auth-entry.png",
  "desktop/test-screenshots/2026-03-09-island-netease-auth-round/02-netease-auth-sheet.png",
  "desktop/test-screenshots/2026-03-09-island-netease-auth-round/03-netease-auth-qr.png",
  "desktop/test-screenshots/2026-03-09-island-netease-auth-round/05-netease-authorized-results.png",
  "desktop/test-screenshots/2026-03-09-island-netease-auth-round/06-netease-authorized-playback.png",
];

const focusFrames = [
  "desktop/test-screenshots/2026-03-08-island-focus-polish-round/02-focus-setup.png",
  "desktop/test-screenshots/2026-03-08-island-focus-polish-round/03-focus-setup-filled.png",
  "desktop/test-screenshots/2026-03-08-island-focus-polish-round/04-focus-run-compact.png",
  "desktop/test-screenshots/2026-03-08-island-focus-polish-round/05-focus-expand-running.png",
  "desktop/test-screenshots/2026-03-08-island-focus-polish-round/09-focus-break-complete.png",
  "desktop/test-screenshots/2026-03-08-island-focus-polish-round/10-focus-log-progress-input.png",
];

const flows = [
  {
    id: "audio-notes-flow",
    frames: audioNotesFrames,
    duration: 1.2,
    title: "Audio Notes -> To Text -> Ask AI",
  },
  {
    id: "studio-watermark-flow",
    frames: studioFrames,
    duration: 1.1,
    title: "Studio -> Remove watermark",
  },
  {
    id: "netease-flow",
    frames: neteaseFrames,
    duration: 1.15,
    title: "NetEase auth -> playback",
  },
  {
    id: "focus-flow",
    frames: focusFrames,
    duration: 1.1,
    title: "Focus session -> log progress",
  },
  {
    id: "full-island-tour",
    frames: [
      audioNotesFrames[0],
      audioNotesFrames[2],
      audioNotesFrames[4],
      studioFrames[1],
      studioFrames[4],
      neteaseFrames[2],
      neteaseFrames[4],
      focusFrames[2],
      focusFrames[5],
    ],
    duration: 1,
    title: "Ark island full tour",
    gifFps: 6,
    gifWidth: 480,
    mp4Width: 1120,
  },
];

const ffmpeg = "ffmpeg";

const run = (args) => {
  const result = spawnSync(ffmpeg, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed: ${args.join(" ")}`);
  }
};

for (const flow of flows) {
  const concatPath = path.join(os.tmpdir(), `${flow.id}-concat.txt`);
  const lines = [];
  for (const frame of flow.frames) {
    const full = path.join(repoRoot, frame);
    lines.push(`file '${full.replace(/'/g, "'\\''")}'`);
    lines.push(`duration ${flow.duration}`);
  }
  const last = path.join(repoRoot, flow.frames.at(-1));
  lines.push(`file '${last.replace(/'/g, "'\\''")}'`);
  writeFileSync(concatPath, `${lines.join("\n")}\n`, "utf8");

  const mp4Path = path.join(outputDir, `${flow.id}.mp4`);
  const gifPath = path.join(outputDir, `${flow.id}.gif`);
  const mp4Width = flow.mp4Width ?? 960;
  const gifFps = flow.gifFps ?? 8;
  const gifWidth = flow.gifWidth ?? 560;

  run([
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatPath,
    "-vf",
    `fps=30,scale=${mp4Width}:-2:flags=lanczos,format=yuv420p`,
    "-movflags",
    "+faststart",
    mp4Path,
  ]);

  run([
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatPath,
    "-vf",
    `fps=${gifFps},scale=${gifWidth}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
    gifPath,
  ]);
}

console.log(`[ark:demos] generated ${flows.length} public demo flows in ${outputDir}`);
