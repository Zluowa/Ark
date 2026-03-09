import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createWatermarkFixture, ensureDir } from "./_iopaint-proof-fixtures.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const outDir = path.join(
  appRoot,
  "test-screenshots",
  "2026-03-07-iopaint-experience-proof",
);
const baseUrl =
  process.env.OMNIAGENT_APP_BASE_URL?.trim() || "http://127.0.0.1:3010";

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

const screenshot = async (page, fileName) => {
  const filePath = path.join(outDir, fileName);
  await page.screenshot({
    path: filePath,
    fullPage: true,
    animations: "disabled",
  });
  return filePath;
};

const main = async () => {
  await ensureDir(outDir);
  const fixtureA = path.join(outDir, "00-source-watermark-a.png");
  const fixtureB = path.join(outDir, "00-source-watermark-b.png");
  await createWatermarkFixture(fixtureA);
  await createWatermarkFixture(fixtureB);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1180 },
    colorScheme: "dark",
  });

  await page.addInitScript(() => {
    window.localStorage.setItem("omniagent-onboarding-complete", "true");
  });

  const report = { outDir, baseUrl, shots: {} };

  try {
    await page.goto(
      `${baseUrl}/dashboard/tools/image.iopaint_studio?preset=watermark&autorun=1&placement=top-right`,
      {
        waitUntil: "domcontentloaded",
        timeout: 120000,
      },
    );
    await page.waitForSelector('input[type="file"]', {
      state: "attached",
      timeout: 120000,
    });

    await page.locator('input[type="file"]').nth(0).setInputFiles(fixtureA);
    await page.waitForSelector('img[alt="IOPaint studio source"]', {
      timeout: 120000,
    });
    await waitForImageLoaded(page, 'img[alt="IOPaint studio source"]', 120000);
    await waitForText(page, "Watermark mask ready", 600000);
    await page.waitForTimeout(1200);
    report.shots.watermarkPreset = await screenshot(
      page,
      "01-watermark-preset-loaded.png",
    );

    await page.getByRole("button", { name: /Inpaint/i }).click();
    await waitForText(page, "Inpaint complete.", 600000);
    await waitForImageLoaded(page, 'img[alt="IOPaint studio source"]', 120000);
    await page.waitForTimeout(1200);
    report.shots.inpaint = await screenshot(page, "02-inpaint-complete.png");

    await page.getByRole("button", { name: "Compare Source" }).click();
    await page.waitForTimeout(600);
    report.shots.compare = await screenshot(page, "03-compare-original.png");

    await page.getByRole("button", { name: "Show Current" }).click();
    await page.waitForTimeout(600);
    await page.locator("button").filter({ hasText: "Source" }).nth(0).click();
    await page.waitForTimeout(600);
    report.shots.historyRestore = await screenshot(
      page,
      "04-history-restore-source.png",
    );

    await page.locator('input[type="file"]').nth(2).setInputFiles([fixtureA, fixtureB]);
    await waitForText(page, "Batch ready", 600000);
    await page.waitForTimeout(1200);
    report.shots.batch = await screenshot(page, "05-batch-watermark-ready.png");
  } finally {
    await browser.close();
  }

  await fs.writeFile(
    path.join(outDir, "report.json"),
    JSON.stringify(report, null, 2),
    "utf8",
  );
  console.log(`[e2e-iopaint-experience] outDir=${outDir}`);
};

main().catch((error) => {
  console.error(
    "[e2e-iopaint-experience] FAIL",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
