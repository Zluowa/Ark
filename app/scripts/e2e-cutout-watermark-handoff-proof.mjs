import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { authHint, withAuthHeaders } from "./_auth-headers.mjs";
import { createWatermarkFixture, ensureDir } from "./_iopaint-proof-fixtures.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const reviewDir = path.resolve(
  appRoot,
  "..",
  "review-screenshots",
  "2026-03-08-cutout-watermark-polish-round",
);
const runtimeDir = path.join(appRoot, "test-screenshots", "2026-03-08-cutout-watermark-proof");
const baseUrl = process.env.OMNIAGENT_APP_BASE_URL?.trim() || "http://127.0.0.1:3010";

const ensureOk = async (response, label) => {
  if (response.ok) return;
  const text = await response.text().catch(() => "");
  throw new Error(`${label} failed: ${response.status} ${text.slice(0, 600)}`);
};

const toAbsoluteUrl = (value) =>
  value.startsWith("http://") || value.startsWith("https://")
    ? value
    : new URL(value, baseUrl).toString();

const uploadFile = async (filePath, contentType = "image/png") => {
  const bytes = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("files", new Blob([bytes], { type: contentType }), path.basename(filePath));
  form.append("scope", "cutout_watermark_handoff_proof");
  const response = await fetch(`${baseUrl}/api/v1/files`, {
    method: "POST",
    headers: withAuthHeaders(),
    body: form,
  });
  await ensureOk(response, `upload ${path.basename(filePath)}`);
  const payload = await response.json();
  const file = payload?.files?.[0];
  const url = String(file?.executor_url || file?.url || "").trim();
  if (!url) {
    throw new Error("upload missing file url");
  }
  return toAbsoluteUrl(url);
};

const executeTool = async (tool, params) => {
  const response = await fetch(`${baseUrl}/api/v1/execute`, {
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

const parseStudioQuery = (studioUrl) => {
  const parsed = new URL(toAbsoluteUrl(studioUrl));
  return {
    href: parsed.toString(),
    source: parsed.searchParams.get("source") || "",
    preset: parsed.searchParams.get("preset") || "",
    placement: parsed.searchParams.get("placement") || "",
    autorun: parsed.searchParams.get("autorun") || "",
    pluginModel: parsed.searchParams.get("plugin_model") || "",
  };
};

const waitForText = async (page, text, timeout = 600000) => {
  await page.waitForFunction(
    (target) => document.body.innerText.includes(target),
    text,
    { timeout },
  );
};

const waitForImageLoaded = async (page, selector, timeout = 120000) => {
  await page.waitForFunction(
    (targetSelector) => {
      const image = document.querySelector(targetSelector);
      return (
        image instanceof HTMLImageElement &&
        image.complete &&
        image.naturalWidth > 0 &&
        image.naturalHeight > 0
      );
    },
    selector,
    { timeout },
  );
};

const waitForEnabledButton = async (page, name, timeout = 120000) => {
  await page.waitForFunction(
    (label) => {
      const buttons = Array.from(document.querySelectorAll("button"));
      return buttons.some((button) => {
        const text = (button.textContent || "").trim();
        return text === label && !button.hasAttribute("disabled");
      });
    },
    name,
    { timeout },
  );
};

const waitForBodyText = async (page, text, timeout = 120000) => {
  await page.waitForFunction(
    (target) => document.body.innerText.includes(target),
    text,
    { timeout },
  );
};

const screenshot = async (page, fileName) => {
  const filePath = path.join(reviewDir, fileName);
  await page.screenshot({
    path: filePath,
    fullPage: true,
    animations: "disabled",
  });
  return filePath;
};

const captureAgentAttachmentDispatch = async ({
  browser,
  filePath,
  query,
  expectedToolId,
  expectedStatusText,
  shotName,
  baseUrl,
}) => {
  const agentPage = await browser.newPage({
    viewport: { width: 1600, height: 1180 },
    colorScheme: "dark",
  });

  await agentPage.addInitScript(() => {
    window.localStorage.setItem("omniagent-onboarding-complete", "true");
  });

  try {
    await agentPage.goto(`${baseUrl}/dashboard/agent`, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    const [fileChooser] = await Promise.all([
      agentPage.waitForEvent("filechooser", { timeout: 120000 }),
      agentPage.getByRole("button", { name: "Add Attachment" }).click(),
    ]);
    await fileChooser.setFiles(filePath);
    await agentPage.getByLabel("Message input").fill(query);
    await agentPage.getByRole("button", { name: "Send message" }).click();
    await waitForBodyText(agentPage, expectedStatusText, 600000);
    await waitForBodyText(agentPage, expectedToolId, 600000);
    await agentPage.waitForTimeout(1200);
    return await screenshot(agentPage, shotName);
  } finally {
    await agentPage.close();
  }
};

const requireString = (value, label) => {
  const next = typeof value === "string" ? value.trim() : "";
  if (!next) {
    throw new Error(`${label} missing`);
  }
  return next;
};

const main = async () => {
  await ensureDir(runtimeDir);
  await ensureDir(reviewDir);

  const fixturePath = path.join(runtimeDir, "00-source-watermark.png");
  await createWatermarkFixture(fixturePath);
  const uploadedUrl = await uploadFile(fixturePath, "image/png");

  const cutoutResult = await executeTool("image.remove_background", {
    file_url: uploadedUrl,
    mode: "auto",
  });
  const cutoutStudioUrl = requireString(cutoutResult.studio_url, "cutout studio_url");
  const cutoutQuery = parseStudioQuery(cutoutStudioUrl);
  if (cutoutQuery.preset !== "remove-background") {
    throw new Error(`cutout preset mismatch: ${cutoutQuery.preset || "missing"}`);
  }
  if (cutoutQuery.autorun !== "1") {
    throw new Error("cutout autorun flag missing");
  }
  if (cutoutQuery.source !== uploadedUrl) {
    throw new Error("cutout Studio source does not point to the original uploaded image");
  }
  if (!cutoutQuery.pluginModel) {
    throw new Error("cutout plugin_model missing from Studio handoff");
  }

  const watermarkResult = await executeTool("image.remove_watermark", {
    file_url: uploadedUrl,
    placement: "top-right",
    mode: "auto",
  });
  const watermarkStudioUrl = requireString(
    watermarkResult.studio_url,
    "watermark studio_url",
  );
  const watermarkQuery = parseStudioQuery(watermarkStudioUrl);
  if (watermarkQuery.preset !== "watermark") {
    throw new Error(`watermark preset mismatch: ${watermarkQuery.preset || "missing"}`);
  }
  if (watermarkQuery.autorun !== "1") {
    throw new Error("watermark autorun flag missing");
  }
  if (watermarkQuery.source !== uploadedUrl) {
    throw new Error("watermark Studio source does not point to the original uploaded image");
  }
  if (watermarkQuery.placement !== "top-right") {
    throw new Error(
      `watermark placement mismatch: ${watermarkQuery.placement || "missing"}`,
    );
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1180 },
    colorScheme: "dark",
  });

  await page.addInitScript(() => {
    window.localStorage.setItem("omniagent-onboarding-complete", "true");
  });

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    authHint,
    reviewDir,
    runtimeDir,
    fixturePath,
    toolResults: {
      cutout: cutoutResult,
      watermark: watermarkResult,
    },
    handoff: {
      cutout: cutoutQuery,
      watermark: watermarkQuery,
    },
    directInputSearch: {},
    agentAttachmentDispatch: {},
    shots: {},
  };

  try {
    await page.goto(cutoutQuery.href, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    await page.waitForSelector('img[alt="IOPaint studio source"]', {
      timeout: 120000,
    });
    await waitForImageLoaded(page, 'img[alt="IOPaint studio source"]', 120000);
    await waitForText(
      page,
      "Cutout ready. Compare source or rerun with another model if needed.",
      600000,
    );
    await waitForEnabledButton(page, "Compare Source", 120000);
    await page.waitForTimeout(1200);
    report.shots.cutoutHandoff = await screenshot(page, "01-cutout-handoff.png");

    await page.getByRole("button", { name: /^Compare Source$/i }).click();
    await page.waitForTimeout(800);
    report.shots.cutoutCompare = await screenshot(page, "02-cutout-compare-source.png");

    await page.goto(watermarkQuery.href, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    await page.waitForSelector('img[alt="IOPaint studio source"]', {
      timeout: 120000,
    });
    await waitForImageLoaded(page, 'img[alt="IOPaint studio source"]', 120000);
    await waitForText(page, "Watermark mask ready", 600000);
    await page.waitForTimeout(1200);
    report.shots.watermarkHandoff = await screenshot(page, "03-watermark-handoff.png");

    await page.getByRole("button", { name: /^Clean watermark$/i }).click();
    await waitForText(page, "Inpaint complete.", 600000);
    await page.waitForTimeout(1200);
    report.shots.watermarkApplied = await screenshot(page, "04-watermark-inpaint.png");

    await page.goto(`${baseUrl}/dashboard/tools`, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    const toolSearchInput = page.getByPlaceholder("Search a tool or action");
    await toolSearchInput.waitFor({ state: "visible", timeout: 120000 });
    await toolSearchInput.fill("扣除背景");
    await page.getByText("Image Remove Background").first().waitFor({ state: "visible", timeout: 120000 });
    await page.waitForTimeout(800);
    report.directInputSearch.cutout = {
      query: "扣除背景",
      matchedTool: "image.remove_background",
    };
    report.shots.cutoutSearch = await screenshot(page, "05-workbench-search-cutout.png");

    await toolSearchInput.fill("去除水印");
    await page.getByText("Image Remove Watermark").first().waitFor({ state: "visible", timeout: 120000 });
    await page.waitForTimeout(800);
    report.directInputSearch.watermark = {
      query: "去除水印",
      matchedTool: "image.remove_watermark",
    };
    report.shots.watermarkSearch = await screenshot(page, "06-workbench-search-watermark.png");

    report.shots.agentCutoutDispatch = await captureAgentAttachmentDispatch({
      browser,
      filePath: fixturePath,
      query: "扣除背景",
      expectedToolId: "image.remove_background",
      expectedStatusText: "Fast-dispatch completed with",
      shotName: "07-agent-dispatch-cutout.png",
      baseUrl,
    });
    report.agentAttachmentDispatch.cutout = {
      query: "扣除背景",
      matchedTool: "image.remove_background",
      filePath: fixturePath,
    };

    report.shots.agentWatermarkDispatch = await captureAgentAttachmentDispatch({
      browser,
      filePath: fixturePath,
      query: "去除水印",
      expectedToolId: "image.remove_watermark",
      expectedStatusText: "Fast-dispatch accepted for",
      shotName: "08-agent-dispatch-watermark.png",
      baseUrl,
    });
    report.agentAttachmentDispatch.watermark = {
      query: "去除水印",
      matchedTool: "image.remove_watermark",
      filePath: fixturePath,
    };
  } finally {
    await browser.close();
  }

  await fsp.writeFile(
    path.join(reviewDir, "report.json"),
    JSON.stringify(report, null, 2),
    "utf8",
  );
  await fsp.writeFile(
    path.join(reviewDir, "README.txt"),
    [
      "Round: 2026-03-08 cutout and watermark handoff polish",
      "Focus:",
      "- image.remove_background Studio handoff keeps the original source, preset, autorun, and plugin model",
      "- image.remove_watermark Studio handoff keeps the original source, placement-aware autorun, and ready-to-continue mask state",
      "- screenshots 01-04 prove cutout continuation, compare-source, watermark autorun, and watermark apply",
      "- screenshots 05-06 prove Chinese direct-input queries still match the active cutout and watermark tools",
      "- screenshots 07-08 prove the Agent composer can upload an image and fast-dispatch Chinese cutout / watermark intents",
      "Source review dir:",
      reviewDir,
    ].join("\n"),
    "utf8",
  );

  console.log(`[e2e-cutout-watermark-handoff] reviewDir=${reviewDir}`);
};

main().catch((error) => {
  console.error(
    "[e2e-cutout-watermark-handoff] FAIL",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
