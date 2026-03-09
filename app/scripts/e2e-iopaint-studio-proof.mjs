import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createWatermarkFixture, ensureDir } from "./_iopaint-proof-fixtures.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const outDir = path.join(appRoot, "test-screenshots", "2026-03-07-iopaint-studio-proof");
const baseUrl = process.env.OMNIAGENT_APP_BASE_URL?.trim() || "http://127.0.0.1:3010";

const waitForText = async (page, text, timeout = 600000) => {
  await page.waitForFunction(
    (target) => document.body.innerText.includes(target),
    text,
    { timeout },
  );
};

const main = async () => {
  await ensureDir(outDir);
  const sourcePath = path.join(outDir, "00-source-watermark.png");
  await createWatermarkFixture(sourcePath);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1100 },
    colorScheme: "dark",
  });

  await page.addInitScript(() => {
    window.localStorage.setItem("omniagent-onboarding-complete", "true");
  });

  const report = { outDir, baseUrl, shots: {} };

  try {
    console.log("[e2e-iopaint] open studio");
    await page.goto(`${baseUrl}/dashboard/tools/image.iopaint_studio`, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    await page.waitForSelector('input[type="file"]', {
      state: "attached",
      timeout: 120000,
    });
    console.log("[e2e-iopaint] upload source");
    await page.locator('input[type="file"]').nth(0).setInputFiles(sourcePath);
    await page.waitForSelector('img[alt="IOPaint studio source"]', { timeout: 120000 });
    await page.waitForTimeout(1200);
    report.shots.loaded = path.join(outDir, '01-studio-loaded.png');
    await page.screenshot({ path: report.shots.loaded, fullPage: true, animations: 'disabled' });

    console.log("[e2e-iopaint] run auto mask");
    await page.getByRole('button', { name: 'Auto Watermark Mask' }).click();
    await waitForText(page, 'Watermark mask ready', 600000);
    await page.waitForTimeout(1200);
    report.shots.mask = path.join(outDir, '02-studio-mask.png');
    await page.screenshot({ path: report.shots.mask, fullPage: true, animations: 'disabled' });

    console.log("[e2e-iopaint] run inpaint");
    await page.getByRole('button', { name: /Inpaint/i }).click();
    await waitForText(page, 'Inpaint complete.', 600000);
    await page.waitForTimeout(1600);
    report.shots.inpaint = path.join(outDir, '03-studio-inpaint.png');
    await page.screenshot({ path: report.shots.inpaint, fullPage: true, animations: 'disabled' });
  } finally {
    await browser.close();
  }

  await fs.writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(`[e2e-iopaint] outDir=${outDir}`);
};

main().catch((error) => {
  console.error('[e2e-iopaint] FAIL', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
