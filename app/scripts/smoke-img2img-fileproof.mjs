import fs from "node:fs";
import path from "node:path";
import { authHint, withAuthHeaders } from "./_auth-headers.mjs";

const appBaseUrl =
  process.env.OMNIAGENT_APP_BASE_URL?.trim() || "http://127.0.0.1:3010";

const ensureOk = async (response, label) => {
  if (response.ok) return;
  const text = await response.text().catch(() => "");
  throw new Error(`${label} failed: ${response.status} ${text.slice(0, 600)}`);
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
  if (!found) throw new Error(`Missing fixture file: ${name}`);
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
  form.append("scope", "island_real_flow");
  const uploadRes = await fetch(`${appBaseUrl}/api/v1/files`, {
    method: "POST",
    headers: withAuthHeaders(),
    body: form,
  });
  await ensureOk(uploadRes, `upload ${path.basename(filePath)}`);
  const uploadBody = await uploadRes.json();
  const file = uploadBody?.files?.[0];
  const url = String(file?.executor_url || file?.url || "").trim();
  if (!url) throw new Error("Upload missing executor url");
  return url.startsWith("http") ? url : `${appBaseUrl}${url}`;
};

const executeTool = async (tool, params) => {
  const response = await fetch(`${appBaseUrl}/api/v1/execute`, {
    method: "POST",
    headers: withAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ tool, params }),
  });
  await ensureOk(response, `execute ${tool}`);
  const payload = await response.json();
  if (payload?.status !== "success") {
    throw new Error(`Tool ${tool} did not return success`);
  }
  return payload?.result ?? {};
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

const downloadToPath = async (url, outputPath) => {
  const full = url.startsWith("http")
    ? url
    : `${appBaseUrl}${url.startsWith("/") ? "" : "/"}${url}`;
  const response = await fetch(full, { headers: withAuthHeaders() });
  await ensureOk(response, `download ${path.basename(outputPath)}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 128) {
    throw new Error(`Downloaded file too small: ${bytes.byteLength} bytes`);
  }
  fs.writeFileSync(outputPath, bytes);
  return bytes.byteLength;
};

const main = async () => {
  const runTag = new Date().toISOString().slice(0, 10);
  const outDir = path.resolve(process.cwd(), "test-screenshots", `${runTag}-real-flow`);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`[img2img-proof] app=${appBaseUrl} ${authHint}`);
  const source = resolveFixture("tmp_image.png");
  const sourceUrl = await uploadFile(source, "image/png");
  const copiedSource = path.join(outDir, "00-reference.png");
  fs.copyFileSync(source, copiedSource);

  const img2img = await executeTool("generate.image", {
    prompt: "将这张参考图重绘成小巧的 Apple 灵动岛风格图标，干净黑底，保留主体轮廓",
    reference_image_url: sourceUrl,
    model: "gemini-3.1-flash-image-preview",
    aspect_ratio: "1:1",
    resolution: "1K",
  });
  const img2imgUrl = findUrlRecursive(img2img);
  if (!img2imgUrl) throw new Error("generate.image (img2img) missing output url");
  const img2imgPath = path.join(outDir, "01-img2img-output.png");
  const img2imgSize = await downloadToPath(img2imgUrl, img2imgPath);

  const imageConvert = await executeTool("image.convert", {
    file_url: sourceUrl,
    format: "webp",
  });
  const convertUrl = findUrlRecursive(imageConvert);
  if (!convertUrl) throw new Error("image.convert missing output url");
  const convertPath = path.join(outDir, "02-file-image-convert.webp");
  const convertSize = await downloadToPath(convertUrl, convertPath);

  const imageCompress = await executeTool("image.compress", {
    file_url: sourceUrl,
    quality: 80,
  });
  const compressUrl = findUrlRecursive(imageCompress);
  if (!compressUrl) throw new Error("image.compress missing output url");
  const compressPath = path.join(outDir, "03-file-image-compress.webp");
  const compressSize = await downloadToPath(compressUrl, compressPath);

  const report = {
    appBaseUrl,
    generatedAt: new Date().toISOString(),
    outputs: {
      reference: copiedSource,
      img2img: { path: img2imgPath, bytes: img2imgSize },
      imageConvert: { path: convertPath, bytes: convertSize },
      imageCompress: { path: compressPath, bytes: compressSize },
    },
  };
  const reportPath = path.join(outDir, "04-real-flow-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`[img2img-proof] reference -> ${copiedSource}`);
  console.log(`[img2img-proof] img2img -> ${img2imgPath} (${img2imgSize} bytes)`);
  console.log(`[img2img-proof] image.convert -> ${convertPath} (${convertSize} bytes)`);
  console.log(`[img2img-proof] image.compress -> ${compressPath} (${compressSize} bytes)`);
  console.log(`[img2img-proof] report -> ${reportPath}`);
  console.log("[img2img-proof] PASS");
};

main().catch((error) => {
  console.error("[img2img-proof] FAIL", error?.message || error);
  process.exitCode = 1;
});
