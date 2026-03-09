import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  createEditFixtureSet,
  dataUrlFromBuffer,
  ensureDir,
} from "./_iopaint-proof-fixtures.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const outDir = path.join(appRoot, "test-screenshots", "2026-03-07-iopaint-full-suite");
const baseUrl =
  process.env.OMNIAGENT_APP_BASE_URL?.trim() || "http://127.0.0.1:3010";

const request = async (pathname, init = {}, timeoutMs = 600000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL(pathname, baseUrl), {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${pathname} failed (${response.status}): ${text.slice(0, 400)}`);
    }
    if (contentType.includes("application/json")) {
      return JSON.parse(text);
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
};

const absoluteUrl = (value) => new URL(value, baseUrl).toString();

const saveRemoteFile = async (url, filePath) => {
  const response = await fetch(absoluteUrl(url), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch artifact ${url}: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(filePath, buffer);
  return filePath;
};

const executeTool = async (tool, params) => {
  const payload = await request(
    "/api/v1/execute",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool, params }),
    },
    600000,
  );
  if (payload.status !== "success") {
    throw new Error(payload.error?.message || `${tool} failed`);
  }
  return payload.result ?? {};
};

const regionMetrics = async (filePath, region) => {
  const image = sharp(filePath, { failOn: "none" });
  const metadata = await image.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const left = Math.max(0, Math.min(width - 1, region.left));
  const top = Math.max(0, Math.min(height - 1, region.top));
  const extractWidth = Math.max(1, Math.min(width - left, region.width));
  const extractHeight = Math.max(1, Math.min(height - top, region.height));
  const { data, info } = await image
    .extract({ left, top, width: extractWidth, height: extractHeight })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let orange = 0;
  let green = 0;
  let brightness = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const a = data[offset + 3];
    if (a < 8) continue;
    if (r > 180 && g > 100 && g < 235 && b < 120) orange += 1;
    if (g > 120 && g > r + 20 && g > b + 20) green += 1;
    brightness += (r + g + b) / 3;
  }

  const pixels = info.width * info.height || 1;
  return {
    orangeRatio: orange / pixels,
    greenRatio: green / pixels,
    avgBrightness: brightness / pixels,
  };
};

const regionDiff = async (leftPath, rightPath, region) => {
  const left = sharp(leftPath, { failOn: "none" });
  const right = sharp(rightPath, { failOn: "none" });
  const leftMeta = await left.metadata();
  const rightMeta = await right.metadata();
  const width = Math.min(leftMeta.width ?? 0, rightMeta.width ?? 0);
  const height = Math.min(leftMeta.height ?? 0, rightMeta.height ?? 0);
  const extract = {
    left: Math.max(0, Math.min(width - 1, region.left)),
    top: Math.max(0, Math.min(height - 1, region.top)),
    width: Math.max(1, Math.min(width - region.left, region.width)),
    height: Math.max(1, Math.min(height - region.top, region.height)),
  };
  const [leftRaw, rightRaw] = await Promise.all([
    left.extract(extract).ensureAlpha().raw().toBuffer(),
    right.extract(extract).ensureAlpha().raw().toBuffer(),
  ]);
  let total = 0;
  const length = Math.min(leftRaw.length, rightRaw.length);
  for (let index = 0; index < length; index += 4) {
    total +=
      Math.abs(leftRaw[index] - rightRaw[index]) +
      Math.abs(leftRaw[index + 1] - rightRaw[index + 1]) +
      Math.abs(leftRaw[index + 2] - rightRaw[index + 2]);
  }
  const pixels = Math.max(1, length / 4);
  return total / (pixels * 3);
};

const createCollage = async (inputPaths, outputPath) => {
  const images = await Promise.all(
    inputPaths.map(async (filePath) => ({
      input: await sharp(filePath).resize({ width: 420 }).png().toBuffer(),
    })),
  );
  const totalWidth = images.length * 420;
  await sharp({
    create: {
      width: totalWidth,
      height: 360,
      channels: 4,
      background: { r: 10, g: 16, b: 24, alpha: 1 },
    },
  })
    .composite(
      images.map((entry, index) => ({
        input: entry.input,
        left: index * 420,
        top: 0,
      })),
    )
    .png()
    .toFile(outputPath);
};

const main = async () => {
  await ensureDir(outDir);
  const fixtures = await createEditFixtureSet(outDir);

  const sourceBuffer = await fs.readFile(fixtures.sourcePath);
  const removeMaskBuffer = await fs.readFile(fixtures.removeMaskPath);
  const textMaskBuffer = await fs.readFile(fixtures.textMaskPath);
  const referenceBuffer = await fs.readFile(fixtures.referencePath);

  const sourceDataUrl = dataUrlFromBuffer(sourceBuffer);
  const removeMaskUrl = dataUrlFromBuffer(removeMaskBuffer);
  const textMaskUrl = dataUrlFromBuffer(textMaskBuffer);
  const referenceUrl = dataUrlFromBuffer(referenceBuffer);

  const removeResult = await executeTool("image.remove_object", {
    file_url: sourceDataUrl,
    mask_url: removeMaskUrl,
    prompt: "Remove the masked orange block and rebuild the dark blue poster background naturally.",
  });
  const replaceResult = await executeTool("image.replace_object", {
    file_url: sourceDataUrl,
    mask_url: removeMaskUrl,
    prompt: "Replace the masked orange block with a matte green geometric emblem.",
    reference_image_url: referenceUrl,
  });
  const addTextResult = await executeTool("image.add_text", {
    file_url: sourceDataUrl,
    mask_url: textMaskUrl,
    text: "OMNIAGENT 2026",
    style: "bold white sans-serif with subtle glow",
    prompt: "Center the title inside the top header band and keep the composition minimal.",
  });
  const outpaintResult = await executeTool("image.outpaint", {
    file_url: sourceDataUrl,
    left: 120,
    right: 220,
    top: 0,
    bottom: 0,
    prompt: "Extend the cinematic poster background and continue the geometric composition naturally.",
  });

  const saved = {
    remove: await saveRemoteFile(removeResult.output_file_url, path.join(outDir, "11-remove-object.png")),
    replace: await saveRemoteFile(replaceResult.output_file_url, path.join(outDir, "12-replace-object.png")),
    addText: await saveRemoteFile(addTextResult.output_file_url, path.join(outDir, "13-add-text.png")),
    outpaint: await saveRemoteFile(outpaintResult.output_file_url, path.join(outDir, "14-outpaint.png")),
  };

  await createCollage(
    [fixtures.sourcePath, saved.remove, saved.replace, saved.addText],
    path.join(outDir, "21-collage-core-edits.png"),
  );
  await createCollage(
    [fixtures.sourcePath, saved.outpaint],
    path.join(outDir, "22-collage-outpaint.png"),
  );

  const objectRegion = { left: 618, top: 228, width: 236, height: 236 };
  const textRegion = { left: 174, top: 96, width: 676, height: 84 };
  const sourceObjectMetrics = await regionMetrics(fixtures.sourcePath, objectRegion);
  const removeObjectMetrics = await regionMetrics(saved.remove, objectRegion);
  const replaceObjectMetrics = await regionMetrics(saved.replace, objectRegion);
  const addTextDiff = await regionDiff(fixtures.sourcePath, saved.addText, textRegion);
  const sourceMeta = await sharp(fixtures.sourcePath).metadata();
  const outpaintMeta = await sharp(saved.outpaint).metadata();

  const report = {
    outDir,
    baseUrl,
    fixtures,
    outputs: saved,
    checks: {
      remove_orange_reduction: {
        source: sourceObjectMetrics.orangeRatio,
        result: removeObjectMetrics.orangeRatio,
        passed: removeObjectMetrics.orangeRatio < sourceObjectMetrics.orangeRatio * 0.4,
      },
      replace_green_presence: {
        source: sourceObjectMetrics.greenRatio,
        result: replaceObjectMetrics.greenRatio,
        passed: replaceObjectMetrics.greenRatio > Math.max(0.08, sourceObjectMetrics.greenRatio + 0.04),
      },
      add_text_region_changed: {
        average_diff: addTextDiff,
        passed: addTextDiff > 18,
      },
      outpaint_expanded: {
        source: { width: sourceMeta.width, height: sourceMeta.height },
        result: { width: outpaintMeta.width, height: outpaintMeta.height },
        passed:
          (outpaintMeta.width ?? 0) > (sourceMeta.width ?? 0) ||
          (outpaintMeta.height ?? 0) > (sourceMeta.height ?? 0),
      },
    },
  };

  await fs.writeFile(
    path.join(outDir, "report.json"),
    JSON.stringify(report, null, 2),
    "utf8",
  );

  const failures = Object.entries(report.checks)
    .filter(([, value]) => !value.passed)
    .map(([key]) => key);
  if (failures.length > 0) {
    throw new Error(`validation failed: ${failures.join(", ")}`);
  }

  console.log(`[smoke-iopaint-full-suite] outDir=${outDir}`);
};

main().catch((error) => {
  console.error(
    "[smoke-iopaint-full-suite] FAIL",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
