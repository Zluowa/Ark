import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const baseUrl =
  process.env.OMNIAGENT_APP_BASE_URL?.trim() || "http://127.0.0.1:3010";

const cases = {
  cutout: {
    query: "扣除背景",
    expectedText: "Fast-dispatch completed with",
    outputPath: path.join(
      appRoot,
      "test-screenshots",
      "debug-fast-dispatch-cutout.png",
    ),
  },
  watermark: {
    query: "去除水印",
    expectedText: "Fast-dispatch accepted for",
    outputPath: path.join(
      appRoot,
      "test-screenshots",
      "debug-fast-dispatch-watermark.png",
    ),
  },
};

const main = async () => {
  const mode = process.argv[2] || "cutout";
  const target = cases[mode];
  if (!target) {
    throw new Error(`Unknown mode: ${mode}`);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1180 },
    colorScheme: "dark",
  });

  try {
    console.log(`[debug-fast-dispatch] mode=${mode}`);
    page.on("console", (message) => {
      console.log(`[page:${message.type()}] ${message.text()}`);
    });
    page.on("pageerror", (error) => {
      console.error("[pageerror]", error);
    });
    page.on("requestfailed", (request) => {
      console.error(
        `[requestfailed] ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`,
      );
    });
    await page.addInitScript(() => {
      window.localStorage.setItem("omniagent-onboarding-complete", "true");
    });

    console.log("[debug-fast-dispatch] goto");
    await page.goto(`${baseUrl}/dashboard/agent`, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    console.log("[debug-fast-dispatch] attach");
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 120000 }),
      page.getByRole("button", { name: "Add Attachment" }).click(),
    ]);
    await chooser.setFiles(
      path.join(
        appRoot,
        "test-screenshots",
        "2026-03-08-cutout-watermark-proof",
        "00-source-watermark.png",
      ),
    );
    console.log("[debug-fast-dispatch] fill");
    await page.getByLabel("Message input").fill(target.query);
    console.log("[debug-fast-dispatch] send");
    await page.getByRole("button", { name: "Send message" }).click();
    console.log("[debug-fast-dispatch] wait-for-text");
    try {
      await page.getByText(target.expectedText, { exact: false }).waitFor({
        timeout: 15000,
      });
      console.log("[debug-fast-dispatch] text-found");
    } catch (error) {
      const failedPath = target.outputPath.replace(".png", "-failed.png");
      const bodyText = await page.locator("body").innerText().catch(() => "");
      await page.screenshot({
        path: failedPath,
        fullPage: true,
        animations: "disabled",
      });
      console.error("[debug-fast-dispatch] text-not-found");
      console.error(bodyText.slice(0, 2000));
      console.error(error);
      throw error;
    }
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: target.outputPath,
      fullPage: true,
      animations: "disabled",
    });
    console.log("[debug-fast-dispatch] screenshot-saved");
    console.log(target.outputPath);
  } finally {
    console.log("[debug-fast-dispatch] close");
    await page.close();
    await browser.close();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
