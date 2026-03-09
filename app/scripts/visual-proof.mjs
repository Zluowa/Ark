import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const appBaseUrl =
  process.env.OMNIAGENT_APP_BASE_URL?.trim() || "http://127.0.0.1:3010";
const outDir =
  process.env.OMNIAGENT_VISUAL_OUTDIR?.trim() ||
  "D:\\Moss\\projects\\omniagent-new\\app\\test-screenshots\\2026-03-06-frontend-visual-proof";

const ensureDir = async (dir) => {
  await fs.mkdir(dir, { recursive: true });
};

const screenshotStep = async (page, fileName, locator) => {
  const target = locator ? page.locator(locator) : page;
  await target.screenshot({
    path: path.join(outDir, fileName),
    animations: "disabled",
  });
};

const assertNoFatalOverlay = async (page) => {
  const body = await page.textContent("body");
  if (!body) return;
  const normalized = body.toLowerCase();
  if (
    normalized.includes("application error") ||
    normalized.includes("runtime error")
  ) {
    throw new Error("Detected application error overlay.");
  }
};

const main = async () => {
  await ensureDir(outDir);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1560, height: 1080 },
    colorScheme: "dark",
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("omniagent-onboarding-complete", "true");
  });

  const report = {
    outDir,
    appBaseUrl,
    shots: {},
  };

  try {
    await page.goto(`${appBaseUrl}/dashboard/agent`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector('textarea[aria-label="Message input"]', {
      timeout: 30000,
    });
    await assertNoFatalOverlay(page);
    await page.fill(
      'textarea[aria-label="Message input"]',
      [
        "Design a rollout plan for the new island interaction system.",
        "Include fallback logic, telemetry checkpoints, and a 16:9 hero visual.",
        "Keep it concrete and shippable.",
      ].join("\n"),
    );
    await page.waitForTimeout(300);
    report.shots.agent = path.join(outDir, "01-dashboard-agent.png");
    await screenshotStep(page, "01-dashboard-agent.png");

    await page.goto(`${appBaseUrl}/dashboard/tools/media.download_video`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector("textarea", { timeout: 30000 });
    await assertNoFatalOverlay(page);
    await page.fill(
      "textarea",
      "Download the source as MP4 and keep the poster thumbnail for reuse.",
    );
    await page.waitForTimeout(300);
    report.shots.toolStandalone = path.join(
      outDir,
      "02-tool-standalone-video.png",
    );
    await screenshotStep(page, "02-tool-standalone-video.png");
  } finally {
    await browser.close();
  }

  const reportPath = path.join(outDir, "report.json");
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`[visual-proof] report=${reportPath}`);
};

main().catch((error) => {
  console.error(
    "[visual-proof] FAIL",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
