import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const appBaseUrl =
  process.env.OMNIAGENT_APP_BASE_URL?.trim() || "http://127.0.0.1:3213";
const apiKey = process.env.OMNIAGENT_VIDBEE_PROOF_API_KEY?.trim() || "";
const primaryUrl =
  process.env.OMNIAGENT_VIDBEE_PROOF_PRIMARY_URL?.trim() ||
  "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4";
const fallbackUrl =
  process.env.OMNIAGENT_VIDBEE_PROOF_FALLBACK_URL?.trim() ||
  "https://www.bilibili.com/video/BV1m34y1F7fD/";
const outDir =
  process.env.OMNIAGENT_VIDBEE_UI_OUTDIR?.trim() ||
  "D:/Moss/projects/omniagent-new/test-screenshots/2026-03-12-vidbee-live-ui-proof";

const flows = [
  {
    id: "video-info",
    screenshot: "01-video-info.png",
    expectedProvider: "vidbee",
  },
  {
    id: "download-video",
    screenshot: "02-download-video.png",
    expectedProvider: "vidbee",
  },
  {
    id: "download-audio",
    screenshot: "03-download-audio.png",
    expectedProvider: "vidbee",
  },
  {
    id: "download-video-fallback",
    screenshot: "04-download-video-fallback.png",
    expectedProvider: "legacy_internal",
  },
];

const readFlowSnapshot = async (page, id) => {
  return page.locator(`[data-testid="flow-${id}"]`).evaluate((node) => {
    const text = node.textContent || "";
    return {
      outputFileUrl: node.getAttribute("data-output-url") || "",
      platform: node.getAttribute("data-platform") || "",
      provider: node.getAttribute("data-provider") || "",
      providerPolicy: node.getAttribute("data-provider-policy") || "",
      providerRoute: node.getAttribute("data-provider-route") || "",
      text,
    };
  });
};

const main = async () => {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    extraHTTPHeaders: apiKey ? { "x-api-key": apiKey } : undefined,
    viewport: { width: 1600, height: 2200 },
  });
  const page = await context.newPage();

  try {
    await page.goto(`${appBaseUrl}/test-vidbee-live`, {
      waitUntil: "networkidle",
      timeout: 120_000,
    });
    await page.waitForSelector('[data-testid="flow-video-info"]', {
      timeout: 120_000,
    });
    await page.locator("input").nth(0).fill(primaryUrl);
    await page.locator("input").nth(1).fill(fallbackUrl);
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(outDir, "00-initial-page.png"),
      fullPage: true,
    });

    const report = {
      appBaseUrl,
      hasApiKey: Boolean(apiKey),
      primaryUrl,
      fallbackUrl,
      flows: {},
      generatedAt: new Date().toISOString(),
    };

    for (const flow of flows) {
      const section = page.locator(`[data-testid="flow-${flow.id}"]`);
      const button = page.locator(`[data-testid="run-${flow.id}"]`);
      await section.scrollIntoViewIfNeeded();
      await button.click();
      await page.waitForFunction(
        (value) => {
          const el = document.querySelector(`[data-testid="flow-${value}"]`);
          return el?.getAttribute("data-phase") === "done";
        },
        flow.id,
        { timeout: 120_000 },
      );
      await page.waitForTimeout(800);
      const snapshot = await readFlowSnapshot(page, flow.id);
      if (snapshot.provider !== flow.expectedProvider) {
        throw new Error(
          `${flow.id} expected provider ${flow.expectedProvider}, got ${snapshot.provider || "missing"}`,
        );
      }
      report.flows[flow.id] = snapshot;
      await section.screenshot({
        path: path.join(outDir, flow.screenshot),
      });
    }

    await page.screenshot({
      path: path.join(outDir, "05-full-page-after-runs.png"),
      fullPage: true,
    });
    await writeFile(
      path.join(outDir, "report.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    await page.screenshot({
      path: path.join(outDir, "99-failure.png"),
      fullPage: true,
    });
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
