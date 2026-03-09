import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createEditFixtureSet, ensureDir } from "./_iopaint-proof-fixtures.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const outDir = path.join(appRoot, "test-screenshots", "2026-03-07-iopaint-outpaint-ui");
const baseUrl =
  process.env.OMNIAGENT_APP_BASE_URL?.trim() || "http://127.0.0.1:3010";

const screenshot = async (page, fileName) => {
  const filePath = path.join(outDir, fileName);
  await page.screenshot({
    path: filePath,
    fullPage: true,
    animations: "disabled",
  });
  return filePath;
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

const main = async () => {
  await fs.rm(outDir, { recursive: true, force: true });
  await ensureDir(outDir);
  const fixtures = await createEditFixtureSet(outDir);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1200 },
    colorScheme: "dark",
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("omniagent-onboarding-complete", "true");
  });

  try {
    await page.goto(`${baseUrl}/dashboard/tools/image.iopaint_studio?preset=outpaint`, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    await page.waitForSelector('input[type="file"]', {
      state: "attached",
      timeout: 120000,
    });
    await uploadViaButton(page, "Load Image", fixtures.sourcePath, 0);
    await page.waitForSelector('img[alt="IOPaint studio source"]', {
      timeout: 120000,
    });
    const imageSelector = 'img[alt="IOPaint studio source"]';
    await waitForImageLoaded(page, imageSelector, 120000);
    await page.waitForTimeout(1000);
    await screenshot(page, "14-outpaint-loaded.png");
    const previousSrc = await getImageSrc(page, imageSelector);

    await page
      .getByPlaceholder("Describe the new area you want beyond the current frame...")
      .fill("Extend the poster scene left and right with matching geometry and lighting.");
    await screenshot(page, "14-outpaint-ready.png");

    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/execute") &&
        response.request().method() === "POST",
      { timeout: 600000 },
    );
    await page.getByRole("button", { name: "Outpaint image" }).click();
    const executeResponse = await responsePromise;
    const payload = await executeResponse.json();
    if (payload?.status && payload.status !== "success") {
      throw new Error(payload?.error?.message || "Outpaint tool failed");
    }
    await waitForImageSrcChange(page, imageSelector, previousSrc, 180000);
    await page.waitForTimeout(1200);
    await screenshot(page, "14-outpaint-result.png");
  } finally {
    await browser.close();
  }

  const files = await fs.readdir(outDir);
  await fs.writeFile(
    path.join(outDir, "report.json"),
    JSON.stringify(
      {
        outDir,
        baseUrl,
        files: files.filter((file) => file.endsWith(".png")).sort(),
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`[e2e-iopaint-outpaint] outDir=${outDir}`);
};

main().catch((error) => {
  console.error(
    "[e2e-iopaint-outpaint] FAIL",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
