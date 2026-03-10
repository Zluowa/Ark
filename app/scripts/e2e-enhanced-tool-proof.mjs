import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { createEnhancedProofFixtures } from "./_enhanced-proof-fixtures.mjs";

const appBaseUrl =
  process.env.OMNIAGENT_APP_BASE_URL?.trim() || "http://127.0.0.1:3010";

const nowTag = new Date().toISOString().slice(0, 10);
const outDir = path.resolve(
  process.cwd(),
  "test-screenshots",
  `${nowTag}-enhanced-frontend-proof`,
);

const textHasFailure = (text) =>
  /upload failed|failed|missing required parameters|error:/i.test(text);

const dismissOnboardingIfVisible = async (page) => {
  const skip = page.locator("button").filter({ hasText: /Skip/i }).first();
  if (await skip.isVisible({ timeout: 1200 }).catch(() => false)) {
    await skip.click({ force: true });
    await page.waitForTimeout(300);
  }
  const overlay = page.locator(".fixed.inset-0.z-50").first();
  if (await overlay.isVisible({ timeout: 800 }).catch(() => false)) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
};

const openToolPage = async (page, toolId) => {
  const url = `${appBaseUrl}/dashboard/tools/${encodeURIComponent(toolId)}`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
  await dismissOnboardingIfVisible(page);
  await page.waitForTimeout(800);
};

const waitForFileToolDone = async (page, timeoutMs = 120000) => {
  await page.waitForFunction(
    () => {
      const text = document.body?.innerText ?? "";
      return text.includes("Done") || text.includes("Processed file");
    },
    { timeout: timeoutMs },
  );
  const bodyText = await page.locator("body").innerText();
  if (textHasFailure(bodyText)) {
    throw new Error(`tool page reported failure: ${bodyText.slice(0, 400)}`);
  }
};

const runFileTool = async ({
  page,
  toolId,
  filePaths,
  screenshotName,
  timeoutMs = 120000,
}) => {
  await openToolPage(page, toolId);
  const input = page.locator("input[type='file']").first();
  await input.setInputFiles(filePaths);
  await waitForFileToolDone(page, timeoutMs);
  const screenshotPath = path.join(outDir, screenshotName);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
};

const runMusicSearchTool = async ({ page, screenshotName }) => {
  await openToolPage(page, "net.music_search");
  const textarea = page.locator("textarea").first();
  await textarea.fill("JJ Lin");
  await page.locator("button").filter({ hasText: /Run/i }).first().click();
  await page.waitForFunction(
    () => {
      const text = document.body?.innerText ?? "";
      return /Music Box/i.test(text) && /[1-9]\d*\s+songs\b/i.test(text);
    },
    { timeout: 120000 },
  );
  const bodyText = await page.locator("body").innerText();
  if (textHasFailure(bodyText)) {
    throw new Error(`music tool reported failure: ${bodyText.slice(0, 400)}`);
  }
  const screenshotPath = path.join(outDir, screenshotName);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
};

const main = async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const fixtures = await createEnhancedProofFixtures(path.join(outDir, "fixtures"));

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.error(`[browser-error] ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => {
    console.error(`[pageerror] ${err.message}`);
  });
  await page.addInitScript(() => {
    localStorage.setItem("omniagent-onboarding-complete", "true");
    localStorage.setItem(
      "omniagent-locale",
      JSON.stringify({ state: { locale: "en" }, version: 0 }),
    );
  });

  try {
    const screenshots = {};
    screenshots.removeWatermark = await runFileTool({
      page,
      toolId: "image.remove_watermark",
      filePaths: [fixtures.watermarkedBottomRightPath],
      screenshotName: "01-image-remove-watermark.png",
    });
    screenshots.removeWatermarkBatch = await runFileTool({
      page,
      toolId: "image.remove_watermark_batch",
      filePaths: [
        fixtures.watermarkedBottomRightPath,
        fixtures.watermarkedTopLeftPath,
      ],
      screenshotName: "02-image-remove-watermark-batch.png",
    });
    screenshots.upscale = await runFileTool({
      page,
      toolId: "image.upscale",
      filePaths: [fixtures.cleanImagePath],
      screenshotName: "03-image-upscale.png",
    });
    screenshots.imageCompress = await runFileTool({
      page,
      toolId: "image.compress",
      filePaths: [fixtures.cleanImagePath],
      screenshotName: "04-image-compress.png",
    });
    screenshots.fileCompress = await runFileTool({
      page,
      toolId: "file.compress",
      filePaths: [fixtures.cleanImagePath, fixtures.textFilePath],
      screenshotName: "05-file-compress.png",
    });
    screenshots.musicSearch = await runMusicSearchTool({
      page,
      screenshotName: "06-music-search.png",
    });

    const reportPath = path.join(outDir, "00-report.json");
    fs.writeFileSync(
      reportPath,
      JSON.stringify(
        {
          appBaseUrl,
          generatedAt: new Date().toISOString(),
          fixtures,
          screenshots,
        },
        null,
        2,
      ),
      "utf8",
    );

    console.log(`[enhanced-frontend-proof] outDir=${outDir}`);
    console.log(`[enhanced-frontend-proof] report=${reportPath}`);
    console.log("[enhanced-frontend-proof] PASS");
  } finally {
    await browser.close();
  }
};

main().catch((error) => {
  console.error("[enhanced-frontend-proof] FAIL", error?.message || error);
  process.exitCode = 1;
});

