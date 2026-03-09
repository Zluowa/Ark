import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWatermarkFixture, dataUrlFromBuffer, ensureDir, writeDataUrlToFile } from "./_iopaint-proof-fixtures.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const outDir = path.join(appRoot, "test-screenshots", "2026-03-07-iopaint-integration-proof");
const baseUrl = process.env.OMNIAGENT_APP_BASE_URL?.trim() || "http://127.0.0.1:3010";

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

const main = async () => {
  await ensureDir(outDir);
  const sourcePath = path.join(outDir, "00-source-watermark.png");
  await createWatermarkFixture(sourcePath);
  const sourceBuffer = await fs.readFile(sourcePath);
  const sourceDataUrl = dataUrlFromBuffer(sourceBuffer);

  const serverConfigEnvelope = await request("/api/iopaint/server-config", {}, 600000);
  const serverConfig = serverConfigEnvelope.result || serverConfigEnvelope;
  await fs.writeFile(
    path.join(outDir, "01-server-config.json"),
    JSON.stringify(serverConfig, null, 2),
    "utf8",
  );

  const samplers = await request("/api/iopaint/samplers", {}, 600000);
  await fs.writeFile(
    path.join(outDir, "02-samplers.json"),
    JSON.stringify(samplers, null, 2),
    "utf8",
  );

  const maskEnvelope = await request(
    "/api/iopaint/remwm/detect-mask",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image: sourceDataUrl, text_input: "watermark" }),
    },
    600000,
  );
  const maskResult = maskEnvelope.result || maskEnvelope;
  await fs.writeFile(
    path.join(outDir, "03-remwm-mask.json"),
    JSON.stringify(maskResult, null, 2),
    "utf8",
  );
  if (!maskResult.mask_data_url) {
    throw new Error("rem-wm mask_data_url missing");
  }
  await writeDataUrlToFile(maskResult.mask_data_url, path.join(outDir, "04-remwm-mask.png"));

  const inpaintEnvelope = await request(
    "/api/iopaint/inpaint",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        image: sourceDataUrl,
        mask: maskResult.mask_data_url,
        model: "lama",
        hd_strategy: "Original",
        sd_keep_unmasked_area: true,
      }),
    },
    600000,
  );
  const inpaintResult = inpaintEnvelope.result || inpaintEnvelope;
  await fs.writeFile(
    path.join(outDir, "05-inpaint-result.json"),
    JSON.stringify(inpaintResult, null, 2),
    "utf8",
  );
  if (!inpaintResult.output_file_url) {
    throw new Error("inpaint output_file_url missing");
  }
  await saveRemoteFile(inpaintResult.output_file_url, path.join(outDir, "06-inpaint-output.png"));

  const report = {
    outDir,
    baseUrl,
    fixture: sourcePath,
    outputs: {
      serverConfig: path.join(outDir, "01-server-config.json"),
      samplers: path.join(outDir, "02-samplers.json"),
      maskMeta: path.join(outDir, "03-remwm-mask.json"),
      maskImage: path.join(outDir, "04-remwm-mask.png"),
      inpaintMeta: path.join(outDir, "05-inpaint-result.json"),
      inpaintImage: path.join(outDir, "06-inpaint-output.png"),
    },
  };
  await fs.writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(`[smoke-iopaint] outDir=${outDir}`);
};

main().catch((error) => {
  console.error("[smoke-iopaint] FAIL", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
