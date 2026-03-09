import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { authHint, withAuthHeaders } from "./_auth-headers.mjs";
import { createEnhancedProofFixtures } from "./_enhanced-proof-fixtures.mjs";

const appBaseUrl =
  process.env.OMNIAGENT_APP_BASE_URL?.trim() || "http://127.0.0.1:3010";

const ensureOk = async (response, label) => {
  if (response.ok) return;
  const text = await response.text().catch(() => "");
  throw new Error(`${label} failed: ${response.status} ${text.slice(0, 600)}`);
};

const uploadFile = async (filePath, contentType) => {
  const bytes = fs.readFileSync(filePath);
  const form = new FormData();
  form.append(
    "files",
    new Blob([bytes], { type: contentType }),
    path.basename(filePath),
  );
  form.append("scope", "enhanced_tools_proof");
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
  const full = url.startsWith("http")
    ? url
    : `${appBaseUrl}${url.startsWith("/") ? "" : "/"}${url}`;
  const response = await fetch(full, { headers: withAuthHeaders() });
  await ensureOk(response, `download ${path.basename(outputPath)}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  fs.writeFileSync(outputPath, bytes);
  return bytes.byteLength;
};

const createSideBySide = async (leftPath, rightPath, outputPath, labels) => {
  const [leftMeta, rightMeta] = await Promise.all([
    sharp(leftPath).metadata(),
    sharp(rightPath).metadata(),
  ]);
  const width = (leftMeta.width ?? 0) + (rightMeta.width ?? 0);
  const height = Math.max(leftMeta.height ?? 0, rightMeta.height ?? 0) + 56;
  const leftBuffer = await sharp(leftPath).toBuffer();
  const rightBuffer = await sharp(rightPath).toBuffer();
  const overlaySvg = `
  <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#0b0b0d"/>
    <text x="24" y="34" fill="#f6f7fb" font-size="20" font-family="Arial" font-weight="700">${labels.left}</text>
    <text x="${(leftMeta.width ?? 0) + 24}" y="34" fill="#f6f7fb" font-size="20" font-family="Arial" font-weight="700">${labels.right}</text>
  </svg>
  `;
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: "#0b0b0d",
    },
  })
    .composite([
      { input: Buffer.from(overlaySvg), top: 0, left: 0 },
      { input: leftBuffer, top: 56, left: 0 },
      { input: rightBuffer, top: 56, left: leftMeta.width ?? 0 },
    ])
    .png()
    .toFile(outputPath);
};

const meanAbsDiffInRect = async (leftPath, rightPath, rect) => {
  const [left, right] = await Promise.all([
    sharp(leftPath)
      .extract(rect)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
    sharp(rightPath)
      .extract(rect)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
  ]);
  let total = 0;
  for (let i = 0; i < left.data.length; i += 1) {
    total += Math.abs(left.data[i] - right.data[i]);
  }
  return total / Math.max(1, left.data.length);
};

const listZipEntries = (zipPath) => {
  const extractDir = path.join(os.tmpdir(), `omni-proof-${Date.now()}`);
  fs.mkdirSync(extractDir, { recursive: true });
  try {
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force`,
      ],
      { stdio: "pipe" },
    );
    return fs
      .readdirSync(extractDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
  } finally {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
};

const main = async () => {
  const runTag = new Date().toISOString().slice(0, 10);
  const outDir = path.resolve(process.cwd(), "test-screenshots", `${runTag}-enhanced-tools-proof`);
  const fixtureDir = path.join(outDir, "fixtures");
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`[enhanced-proof] app=${appBaseUrl} ${authHint}`);
  const fixtures = await createEnhancedProofFixtures(fixtureDir);

  const [
    cleanUrl,
    watermarkBrUrl,
    watermarkTlUrl,
    textFileUrl,
  ] = await Promise.all([
    uploadFile(fixtures.cleanImagePath, "image/png"),
    uploadFile(fixtures.watermarkedBottomRightPath, "image/png"),
    uploadFile(fixtures.watermarkedTopLeftPath, "image/png"),
    uploadFile(fixtures.textFilePath, "text/plain"),
  ]);

  const removeWatermarkResult = await executeTool("image.remove_watermark", {
    file_url: watermarkBrUrl,
    placement: "bottom-right",
    mode: "traditional",
  });
  const cleanedImageUrl = findUrlRecursive(removeWatermarkResult);
  if (!cleanedImageUrl) throw new Error("image.remove_watermark missing output url");
  const cleanedImagePath = path.join(outDir, "01-remove-watermark.png");
  await downloadToPath(cleanedImageUrl, cleanedImagePath);

  const upscaleResult = await executeTool("image.upscale", {
    file_url: cleanUrl,
    scale: 2,
    mode: "traditional",
  });
  const upscaleUrl = findUrlRecursive(upscaleResult);
  if (!upscaleUrl) throw new Error("image.upscale missing output url");
  const upscalePath = path.join(outDir, "02-upscale.png");
  await downloadToPath(upscaleUrl, upscalePath);

  const imageCompressResult = await executeTool("image.compress", {
    file_url: cleanUrl,
    quality: 72,
  });
  const imageCompressUrl = findUrlRecursive(imageCompressResult);
  if (!imageCompressUrl) throw new Error("image.compress missing output url");
  const imageCompressPath = path.join(outDir, "03-image-compress.webp");
  await downloadToPath(imageCompressUrl, imageCompressPath);

  const batchWatermarkResult = await executeTool("image.remove_watermark_batch", {
    file_urls: [watermarkBrUrl, watermarkTlUrl],
    mode: "traditional",
  });
  const batchZipUrl = findUrlRecursive(batchWatermarkResult);
  if (!batchZipUrl) throw new Error("image.remove_watermark_batch missing output url");
  const batchZipPath = path.join(outDir, "04-batch-remove-watermark.zip");
  await downloadToPath(batchZipUrl, batchZipPath);

  const fileCompressResult = await executeTool("file.compress", {
    file_urls: [textFileUrl, cleanUrl],
    filenames: [
      path.basename(fixtures.textFilePath),
      path.basename(fixtures.cleanImagePath),
    ],
  });
  const fileCompressUrl = findUrlRecursive(fileCompressResult);
  if (!fileCompressUrl) throw new Error("file.compress missing output url");
  const fileCompressPath = path.join(outDir, "05-file-compress.zip");
  await downloadToPath(fileCompressUrl, fileCompressPath);

    const musicSearchResult = await executeTool("net.music_search", {
    query: "JJ Lin",
  });

  const watermarkComparePath = path.join(outDir, "06-watermark-before-after.png");
  await createSideBySide(
    fixtures.watermarkedBottomRightPath,
    cleanedImagePath,
    watermarkComparePath,
    { left: "Before", right: "After" },
  );

  const upscaleComparePath = path.join(outDir, "07-upscale-before-after.png");
  await createSideBySide(
    fixtures.cleanImagePath,
    upscalePath,
    upscaleComparePath,
    { left: "Original", right: "Upscaled" },
  );

  const [cleanMeta, upscaleMeta] = await Promise.all([
    sharp(fixtures.cleanImagePath).metadata(),
    sharp(upscalePath).metadata(),
  ]);
  const watermarkRect = { left: 404, top: 332, width: 228, height: 44 };
  const [watermarkBeforeDelta, watermarkAfterDelta] = await Promise.all([
    meanAbsDiffInRect(fixtures.watermarkedBottomRightPath, fixtures.cleanImagePath, watermarkRect),
    meanAbsDiffInRect(cleanedImagePath, fixtures.cleanImagePath, watermarkRect),
  ]);
  const originalBytes = fs.statSync(fixtures.cleanImagePath).size;
  const compressedBytes = fs.statSync(imageCompressPath).size;
  const batchEntries = listZipEntries(batchZipPath);
  const archiveEntries = listZipEntries(fileCompressPath);
  const songs = Array.isArray(musicSearchResult?.json?.songs)
    ? musicSearchResult.json.songs
    : Array.isArray(musicSearchResult?.songs)
      ? musicSearchResult.songs
      : [];

  const report = {
    appBaseUrl,
    generatedAt: new Date().toISOString(),
    fixtures,
    outputs: {
      cleanedImagePath,
      upscalePath,
      imageCompressPath,
      batchZipPath,
      fileCompressPath,
      watermarkComparePath,
      upscaleComparePath,
    },
    assertions: {
      watermarkRemoval: fs.existsSync(cleanedImagePath),
      watermarkBeforeDelta,
      watermarkAfterDelta,
      watermarkImproved: watermarkAfterDelta < watermarkBeforeDelta * 0.6,
      upscaleBigger:
        (upscaleMeta.width ?? 0) > (cleanMeta.width ?? 0) &&
        (upscaleMeta.height ?? 0) > (cleanMeta.height ?? 0),
      compressSmaller: compressedBytes < originalBytes,
      batchZipEntries: batchEntries,
      fileArchiveEntries: archiveEntries,
      musicResultCount: songs.length,
      firstSong: songs[0]
        ? {
            id: songs[0].id,
            name: songs[0].name,
            artist: songs[0].artist,
          }
        : null,
    },
    raw: {
      removeWatermarkResult,
      upscaleResult,
      imageCompressResult,
      batchWatermarkResult,
      fileCompressResult,
      musicSearchResult,
    },
  };

  if (!report.assertions.upscaleBigger) {
    throw new Error("Upscale output did not increase dimensions.");
  }
  if (!report.assertions.compressSmaller) {
    throw new Error("Image compression output is not smaller than original.");
  }
  if (!report.assertions.watermarkImproved) {
    throw new Error(`Watermark cleanup did not improve enough. before=${watermarkBeforeDelta.toFixed(3)} after=${watermarkAfterDelta.toFixed(3)}`);
  }
  if (batchEntries.length < 2) {
    throw new Error("Batch watermark archive does not contain two cleaned images.");
  }
  if (!archiveEntries.some((name) => name.endsWith(".txt")) || !archiveEntries.some((name) => name.endsWith(".png"))) {
    throw new Error("Generic file archive is missing expected source files.");
  }
  if (songs.length === 0) {
    throw new Error("Music search returned no songs.");
  }

  const reportPath = path.join(outDir, "00-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`[enhanced-proof] report=${reportPath}`);
  console.log(`[enhanced-proof] outDir=${outDir}`);
  console.log("[enhanced-proof] PASS");
};

main().catch((error) => {
  console.error("[enhanced-proof] FAIL", error?.message || error);
  process.exitCode = 1;
});

