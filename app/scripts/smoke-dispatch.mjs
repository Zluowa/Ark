import { authHint, withAuthHeaders } from "./_auth-headers.mjs";

const appBaseUrl =
  process.env.OMNIAGENT_APP_BASE_URL ?? "http://127.0.0.1:3010";

const cases = [
  {
    expectedTool: "official.pdf.compress",
    prompt: "请帮我压缩这个 PDF 文件体积",
    params: {
      file: "https://example.com/sample.pdf",
      quality: 72,
    },
  },
  {
    expectedTool: "official.pdf.merge",
    prompt: "merge two pdf files into one",
    params: {
      files: ["https://example.com/a.pdf", "https://example.com/b.pdf"],
    },
  },
  {
    expectedTool: "official.pdf.split",
    prompt: "split this pdf by page ranges",
    params: {
      file: "https://example.com/sample.pdf",
      ranges: "1-2,3-",
    },
  },
  {
    expectedTool: "official.image.compress",
    prompt: "压缩图片，不要改变分辨率",
    params: {
      file: "https://example.com/sample.jpg",
      quality: 81,
    },
  },
  {
    expectedTool: "official.image.convert",
    prompt: "convert image to webp format",
    params: {
      file: "https://example.com/sample.jpg",
      target_format: "webp",
    },
  },
  {
    expectedTool: "official.image.crop",
    prompt: "crop this image to a smaller area",
    params: {
      file: "https://example.com/sample.jpg",
      x: 12,
      y: 24,
      width: 360,
      height: 200,
    },
  },
  {
    expectedTool: "official.video.transcode",
    prompt: "视频转码成 mp4",
    params: {
      file: "https://example.com/sample.mov",
      target_format: "mp4",
    },
  },
  {
    expectedTool: "official.video.extract_audio",
    prompt: "extract audio from this video as mp3",
    params: {
      file: "https://example.com/sample.mp4",
      target_format: "mp3",
    },
  },
  {
    expectedTool: "official.video.clip",
    prompt: "trim a video clip from 5s to 10s",
    params: {
      file: "https://example.com/sample.mp4",
      start_seconds: 5,
      end_seconds: 10,
    },
  },
  {
    expectedTool: "official.utility.json_format",
    prompt: "format this json string",
    params: {
      text: '{"a":1,"b":{"ok":true}}',
    },
  },
];

const ensureOk = async (res, label) => {
  if (res.ok) return;
  const body = await res.text();
  throw new Error(`${label} failed (${res.status}): ${body.slice(0, 500)}`);
};

const main = async () => {
  console.log(`[dispatch-smoke] app=${appBaseUrl} ${authHint}`);

  let passed = 0;
  for (const item of cases) {
    const res = await fetch(`${appBaseUrl}/api/v1/dispatch`, {
      method: "POST",
      headers: withAuthHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        mode: "sync",
        prompt: item.prompt,
        params: item.params,
      }),
    });
    await ensureOk(res, `POST /api/v1/dispatch (${item.expectedTool})`);
    const body = await res.json();

    if (body?.channel !== "fast") {
      throw new Error(`Expected fast channel for ${item.expectedTool}`);
    }
    if (body?.match?.tool !== item.expectedTool) {
      throw new Error(
        `Expected ${item.expectedTool}, got ${body?.match?.tool ?? "unknown"}`,
      );
    }
    if (body?.execution?.status !== "success") {
      throw new Error(`Execution failed for ${item.expectedTool}`);
    }

    passed += 1;
    console.log(
      `[dispatch-smoke] ${item.expectedTool} <- "${item.prompt}" => success`,
    );
  }

  console.log(`[dispatch-smoke] PASS (${passed}/${cases.length})`);
};

main().catch((error) => {
  console.error(
    "[dispatch-smoke] FAIL",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
