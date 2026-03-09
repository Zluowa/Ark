import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { authHint, withAuthHeaders } from "./_auth-headers.mjs";

const appBaseUrl = process.env.OMNIAGENT_APP_BASE_URL?.trim() || "http://127.0.0.1:3010";
const owlSourcePath = path.resolve("test-fixtures/window-upload-proof/sample.png");

const ensureOk = async (response, label) => {
  if (response.ok) return;
  const text = await response.text().catch(() => "");
  throw new Error(`${label} failed: ${response.status} ${text.slice(0, 600)}`);
};

const uploadFile = async (filePath, contentType) => {
  const bytes = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("files", new Blob([bytes], { type: contentType }), path.basename(filePath));
  form.append("scope", "upload_image_entry_proof");
  const response = await fetch(`${appBaseUrl}/api/v1/files`, {
    method: "POST",
    headers: withAuthHeaders(),
    body: form,
  });
  await ensureOk(response, `upload ${path.basename(filePath)}`);
  const payload = await response.json();
  const file = payload?.files?.[0];
  const url = String(file?.executor_url || file?.url || "").trim();
  if (!url) throw new Error("upload missing file url");
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
    throw new Error(`Tool ${tool} returned ${payload?.status ?? "unknown"}`);
  }
  return payload?.result ?? {};
};

const findUrlRecursive = (value) => {
  if (!value) return "";
  if (typeof value === "string") {
    if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("/api/")) {
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
    for (const key of ["output_file_url", "output_url", "download_url", "file_url", "url"]) {
      const found = findUrlRecursive(value[key]);
      if (found) return found;
    }
    for (const nested of Object.values(value)) {
      const found = findUrlRecursive(nested);
      if (found) return found;
    }
  }
  return "";
};

const downloadToPath = async (url, outputPath) => {
  const full = url.startsWith("http") ? url : `${appBaseUrl}${url.startsWith("/") ? "" : "/"}${url}`;
  const response = await fetch(full, { headers: withAuthHeaders() });
  await ensureOk(response, `download ${path.basename(outputPath)}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  fs.writeFileSync(outputPath, bytes);
  return bytes.byteLength;
};

const buildWatermarkSpec = (width, height) => {
  const boxWidth = Math.round(width * 0.42);
  const boxHeight = Math.round(height * 0.07);
  const left = width - boxWidth - 14;
  const top = height - boxHeight - 14;
  return { left, top, width: boxWidth, height: boxHeight };
};

const watermarkOverlaySvg = (width, height, rect, label) => `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${rect.left}" y="${rect.top}" width="${rect.width}" height="${rect.height}" rx="16" fill="rgba(255,255,255,0.24)"/>
  <text x="${rect.left + rect.width - 18}" y="${rect.top + rect.height * 0.66}" text-anchor="end" fill="rgba(255,255,255,0.96)"
    font-size="${Math.max(20, Math.round(rect.height * 0.42))}" font-family="Arial, Helvetica, sans-serif" font-weight="700">${label}</text>
</svg>
`.trim();

const createWatermarkedFixture = async (sourcePath, outputPath) => {
  const meta = await sharp(sourcePath).metadata();
  const rect = buildWatermarkSpec(meta.width ?? 0, meta.height ?? 0);
  await sharp(sourcePath)
    .composite([{ input: Buffer.from(watermarkOverlaySvg(meta.width ?? 0, meta.height ?? 0, rect, "OMNI WATERMARK")) }])
    .png()
    .toFile(outputPath);
  return { rect, width: meta.width ?? 0, height: meta.height ?? 0 };
};

const analyzeAlphaQuality = async (imagePath) => {
  const { data, info } = await sharp(imagePath, { failOn: "none" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let transparent = 0;
  let semi = 0;
  let opaque = 0;
  let minAlpha = 255;
  let maxAlpha = 0;
  for (let index = 3; index < data.length; index += info.channels) {
    const alpha = data[index];
    if (alpha <= 6) transparent += 1;
    else if (alpha >= 249) opaque += 1;
    else semi += 1;
    if (alpha < minAlpha) minAlpha = alpha;
    if (alpha > maxAlpha) maxAlpha = alpha;
  }
  const pixels = Math.max(1, transparent + semi + opaque);
  return {
    transparentRatio: transparent / pixels,
    semiTransparentRatio: semi / pixels,
    opaqueRatio: opaque / pixels,
    alphaRange: maxAlpha - minAlpha,
    usable:
      maxAlpha - minAlpha >= 20 &&
      transparent / pixels >= 0.01 &&
      transparent / pixels <= 0.98 &&
      opaque / pixels >= 0.01,
  };
};

const meanAbsDiffInRect = async (leftPath, rightPath, rect) => {
  const [left, right] = await Promise.all([
    sharp(leftPath).extract(rect).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(rightPath).extract(rect).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  let total = 0;
  for (let i = 0; i < left.data.length; i += 1) {
    total += Math.abs(left.data[i] - right.data[i]);
  }
  return total / Math.max(1, left.data.length);
};

const createSideBySide = async (leftPath, rightPath, outputPath, labels) => {
  const [leftMeta, rightMeta] = await Promise.all([sharp(leftPath).metadata(), sharp(rightPath).metadata()]);
  const width = (leftMeta.width ?? 0) + (rightMeta.width ?? 0);
  const height = Math.max(leftMeta.height ?? 0, rightMeta.height ?? 0) + 52;
  const overlaySvg = `
  <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#0b0b0d"/>
    <text x="18" y="32" fill="#f6f7fb" font-size="18" font-family="Arial" font-weight="700">${labels.left}</text>
    <text x="${(leftMeta.width ?? 0) + 18}" y="32" fill="#f6f7fb" font-size="18" font-family="Arial" font-weight="700">${labels.right}</text>
  </svg>`;
  await sharp({ create: { width, height, channels: 4, background: "#0b0b0d" } })
    .composite([
      { input: Buffer.from(overlaySvg), top: 0, left: 0 },
      { input: await sharp(leftPath).toBuffer(), top: 52, left: 0 },
      { input: await sharp(rightPath).toBuffer(), top: 52, left: leftMeta.width ?? 0 },
    ])
    .png()
    .toFile(outputPath);
};

const main = async () => {
  if (!fs.existsSync(owlSourcePath)) {
    throw new Error(`background fixture missing: ${owlSourcePath}`);
  }

  const runTag = new Date().toISOString().slice(0, 10);
  const outDir = path.resolve(process.cwd(), "test-screenshots", `${runTag}-upload-image-entry-proof`);
  fs.mkdirSync(outDir, { recursive: true });

  const owlCopyPath = path.join(outDir, "00-owl-source.jpg");
  fs.copyFileSync(owlSourcePath, owlCopyPath);
  const watermarkedPath = path.join(outDir, "01-owl-watermarked.png");
  const watermarkFixture = await createWatermarkedFixture(owlCopyPath, watermarkedPath);

  console.log(`[upload-image-entry-proof] app=${appBaseUrl} ${authHint}`);

  const [owlUrl, watermarkedUrl] = await Promise.all([
    uploadFile(owlCopyPath, "image/jpeg"),
    uploadFile(watermarkedPath, "image/png"),
  ]);

  const removeBackgroundResult = await executeTool("image.remove_background", {
    file_url: owlUrl,
    mode: "auto",
  });
  const removeBackgroundUrl = findUrlRecursive(removeBackgroundResult);
  if (!removeBackgroundUrl) throw new Error("image.remove_background missing output url");
  const removeBackgroundPath = path.join(outDir, "02-remove-background.png");
  await downloadToPath(removeBackgroundUrl, removeBackgroundPath);
  const backgroundAlpha = await analyzeAlphaQuality(removeBackgroundPath);

  const removeWatermarkResult = await executeTool("image.remove_watermark", {
    file_url: watermarkedUrl,
    placement: "bottom-right",
    mode: "auto",
  });
  const removeWatermarkUrl = findUrlRecursive(removeWatermarkResult);
  if (!removeWatermarkUrl) throw new Error("image.remove_watermark missing output url");
  const removeWatermarkPath = path.join(outDir, "03-remove-watermark.png");
  await downloadToPath(removeWatermarkUrl, removeWatermarkPath);

  const backgroundComparePath = path.join(outDir, "04-background-before-after.png");
  await createSideBySide(owlCopyPath, removeBackgroundPath, backgroundComparePath, {
    left: "Original",
    right: "Background Removed",
  });

  const watermarkComparePath = path.join(outDir, "05-watermark-before-after.png");
  await createSideBySide(watermarkedPath, removeWatermarkPath, watermarkComparePath, {
    left: "Watermarked",
    right: "Cleaned",
  });

  const watermarkBeforeDelta = await meanAbsDiffInRect(watermarkedPath, owlCopyPath, watermarkFixture.rect);
  const watermarkAfterDelta = await meanAbsDiffInRect(removeWatermarkPath, owlCopyPath, watermarkFixture.rect);

  const report = {
    appBaseUrl,
    generatedAt: new Date().toISOString(),
    fixture: {
      owlSourcePath,
      owlCopyPath,
      watermarkedPath,
      watermarkRect: watermarkFixture.rect,
    },
    outputs: {
      removeBackgroundPath,
      removeWatermarkPath,
      backgroundComparePath,
      watermarkComparePath,
    },
    assertions: {
      backgroundAlpha,
      backgroundUsable: backgroundAlpha.usable,
      watermarkBeforeDelta,
      watermarkAfterDelta,
      watermarkImproved: watermarkAfterDelta < watermarkBeforeDelta * 0.72,
    },
    raw: {
      removeBackgroundResult,
      removeWatermarkResult,
    },
  };

  if (!report.assertions.backgroundUsable) {
    throw new Error(`Background removal alpha quality is weak: ${JSON.stringify(backgroundAlpha)}`);
  }
  if (!report.assertions.watermarkImproved) {
    throw new Error(`Watermark cleanup insufficient. before=${watermarkBeforeDelta.toFixed(3)} after=${watermarkAfterDelta.toFixed(3)}`);
  }

  const reportPath = path.join(outDir, "00-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`[upload-image-entry-proof] report=${reportPath}`);
  console.log(`[upload-image-entry-proof] outDir=${outDir}`);
  console.log("[upload-image-entry-proof] PASS");
};

main().catch((error) => {
  console.error("[upload-image-entry-proof] FAIL", error?.message || error);
  process.exitCode = 1;
});
