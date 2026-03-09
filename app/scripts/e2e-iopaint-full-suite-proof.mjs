import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createEditFixtureSet, ensureDir } from "./_iopaint-proof-fixtures.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const outDir =
  process.env.IOPAINT_OUT_DIR?.trim() ||
  path.join(appRoot, "test-screenshots", "2026-03-07-iopaint-full-suite-ui");
const baseUrl =
  process.env.OMNIAGENT_APP_BASE_URL?.trim() || "http://127.0.0.1:3010";
const onlyPreset = process.env.IOPAINT_ONLY_PRESET?.trim() || "";
const appendMode = process.env.IOPAINT_APPEND === "1";

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

const waitForMaskCanvasReady = async (page, timeout = 120000) => {
  await page.waitForFunction(
    () => {
      const canvases = Array.from(document.querySelectorAll("canvas"));
      if (canvases.length < 2) return false;
      const maskCanvas = canvases[canvases.length - 1];
      return (
        maskCanvas instanceof HTMLCanvasElement &&
        maskCanvas.width >= 512 &&
        maskCanvas.height >= 512
      );
    },
    undefined,
    { timeout },
  );
};

const getImageSrc = async (page, selector) =>
  page.locator(selector).evaluate((node) => {
    if (!(node instanceof HTMLImageElement)) return "";
    return node.currentSrc || node.src || "";
  });

const waitForImageSrcChange = async (page, selector, previousSrc, timeout = 180000) => {
  await page.waitForFunction(
    ({ targetSelector, previous }) => {
      const image = document.querySelector(targetSelector);
      return (
        image instanceof HTMLImageElement &&
        image.complete &&
        image.naturalWidth > 0 &&
        Boolean((image.currentSrc || image.src || "").trim()) &&
        (image.currentSrc || image.src || "") !== previous
      );
    },
    { targetSelector: selector, previous: previousSrc },
    { timeout },
  );
};

const drawMaskRect = async (page, rectNorm) => {
  await page.evaluate((rect) => {
    const canvases = Array.from(document.querySelectorAll("canvas"));
    const maskCanvas = canvases[canvases.length - 1];
    if (!(maskCanvas instanceof HTMLCanvasElement)) {
      throw new Error("Mask canvas unavailable");
    }
    const context = maskCanvas.getContext("2d");
    if (!context) {
      throw new Error("Mask context unavailable");
    }
    const left = maskCanvas.width * rect.left;
    const top = maskCanvas.height * rect.top;
    const width = maskCanvas.width * rect.width;
    const height = maskCanvas.height * rect.height;
    context.save();
    context.fillStyle = "rgba(255,255,255,0.92)";
    context.fillRect(left, top, width, height);
    context.restore();
  }, rectNorm);
};

const screenshot = async (page, fileName) => {
  const filePath = path.join(outDir, fileName);
  await page.screenshot({
    path: filePath,
    fullPage: true,
    animations: "disabled",
  });
  return filePath;
};

const uploadViaButton = async (page, buttonName, filePath, fallbackInputIndex = 0) => {
  await page.waitForTimeout(800);
  const chooserPromise = page
    .waitForEvent("filechooser", { timeout: 15000 })
    .catch(() => null);
  await page.getByRole("button", { name: new RegExp(`^${buttonName}$`, "i") }).click();
  const chooser = await chooserPromise;
  if (chooser) {
    await chooser.setFiles(filePath);
    return;
  }
  await page.locator('input[type="file"]').nth(fallbackInputIndex).setInputFiles(filePath);
};

const runPreset = async ({
  browser,
  preset,
  sourcePath,
  referencePath,
  name,
  drawRect,
  prompt,
  exactText,
  textStyle,
  outpaint,
  shotPrefix,
}) => {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1200 },
    colorScheme: "dark",
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("omniagent-onboarding-complete", "true");
  });

  try {
    await page.goto(
      `${baseUrl}/dashboard/tools/image.iopaint_studio?preset=${preset}`,
      {
        waitUntil: "domcontentloaded",
        timeout: 120000,
      },
    );
    await page.waitForSelector('input[type="file"]', {
      state: "attached",
      timeout: 120000,
    });
    await uploadViaButton(page, "Load Image", sourcePath, 0);
    await page.waitForSelector('img[alt="IOPaint studio source"]', {
      timeout: 120000,
    });
    const imageSelector = 'img[alt="IOPaint studio source"]';
    await waitForImageLoaded(page, imageSelector, 120000);
    await waitForMaskCanvasReady(page, 120000);
    await page.waitForTimeout(1200);
    await screenshot(page, `${shotPrefix}-loaded.png`);
    const previousSrc = await getImageSrc(page, imageSelector);

    if (drawRect) {
      await drawMaskRect(page, drawRect);
      await page.waitForTimeout(400);
    }
    if (referencePath) {
      await uploadViaButton(page, "Load Reference", referencePath, 1);
      await waitForText(page, "Reference loaded", 120000);
    }
    if (exactText) {
      await page.getByPlaceholder(/Exact text/i).fill(exactText);
    }
    if (textStyle) {
      await page.getByPlaceholder(/Text style/i).fill(textStyle);
    }
    if (prompt) {
      const textarea = page.locator("textarea").first();
      await textarea.fill(prompt);
    }
    await screenshot(page, `${shotPrefix}-ready.png`);
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/execute") &&
        response.request().method() === "POST",
      { timeout: 600000 },
    );
    await page.getByRole("button", { name }).click();
    const executeResponse = await responsePromise;
    const executePayload = await executeResponse.json();
    if (executePayload?.status && executePayload.status !== "success") {
      throw new Error(
        executePayload?.error?.message || `Tool execution failed for ${preset}`,
      );
    }
    await waitForImageSrcChange(page, imageSelector, previousSrc, 180000);
    await page.waitForTimeout(1200);
    await screenshot(page, `${shotPrefix}-result.png`);
  } finally {
    await page.close();
  }
};

const main = async () => {
  if (!appendMode) {
    await fs.rm(outDir, { recursive: true, force: true });
  }
  await ensureDir(outDir);
  const fixtures = await createEditFixtureSet(outDir);

  const browser = await chromium.launch({ headless: true });
  const report = { outDir, baseUrl, fixtures, shots: {} };
  const objectRect = { left: 618 / 1024, top: 228 / 768, width: 236 / 1024, height: 236 / 768 };
  const textRect = { left: 174 / 1024, top: 96 / 768, width: 676 / 1024, height: 84 / 768 };
  const shouldRun = (preset) => !onlyPreset || onlyPreset === preset;

  try {
    if (shouldRun("remove-object")) {
      await runPreset({
        browser,
        preset: "remove-object",
        sourcePath: fixtures.sourcePath,
        name: "Remove object",
        drawRect: objectRect,
        prompt: "Remove the orange block and reconstruct the background naturally.",
        shotPrefix: "11-remove-object",
      });
    }
    if (shouldRun("replace-object")) {
      await runPreset({
        browser,
        preset: "replace-object",
        sourcePath: fixtures.sourcePath,
        referencePath: fixtures.referencePath,
        name: "Replace object",
        drawRect: objectRect,
        prompt: "Replace the orange block with the loaded green emblem.",
        shotPrefix: "12-replace-object",
      });
    }
    if (shouldRun("add-text")) {
      await runPreset({
        browser,
        preset: "add-text",
        sourcePath: fixtures.sourcePath,
        name: "Render text",
        drawRect: textRect,
        exactText: "OMNIAGENT 2026",
        textStyle: "bold white sans-serif with subtle glow",
        prompt: "Center it in the header band and preserve the minimal poster layout.",
        shotPrefix: "13-add-text",
      });
    }
  } finally {
    await browser.close();
  }

  const files = await fs.readdir(outDir);
  report.shots = files.filter((file) => file.endsWith(".png")).sort();
  await fs.writeFile(
    path.join(outDir, "report.json"),
    JSON.stringify(report, null, 2),
    "utf8",
  );
  console.log(`[e2e-iopaint-full-suite] outDir=${outDir}`);
};

main().catch((error) => {
  console.error(
    "[e2e-iopaint-full-suite] FAIL",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
