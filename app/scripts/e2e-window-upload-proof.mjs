import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const appBaseUrl =
  process.env.OMNIAGENT_APP_BASE_URL?.trim() || "http://127.0.0.1:3010";

const nowTag = new Date().toISOString().slice(0, 10);
const outDir = path.resolve(
  process.cwd(),
  "test-screenshots",
  `${nowTag}-window-upload-proof`,
);
const fixtureDir = path.resolve(process.cwd(), "test-fixtures", "window-upload-proof");

const mustExist = (filePath) => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing fixture: ${filePath}`);
  }
};

const textHasFailure = (text) =>
  /upload failed|failed|missing required parameters/i.test(text);

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

const waitForStandaloneDone = async (page, timeoutMs = 120000) => {
  await page.waitForFunction(
    () => {
      const text = document.body?.innerText ?? "";
      return (
        text.includes("Done") ||
        text.includes("Failed") ||
        text.includes("Missing required parameters")
      );
    },
    { timeout: timeoutMs },
  );
  const bodyText = await page.locator("body").innerText();
  if (textHasFailure(bodyText)) {
    throw new Error(`Tool page reported failure: ${bodyText.slice(0, 400)}`);
  }
};

const openToolPage = async (page, toolId) => {
  const url = `${appBaseUrl}/dashboard/tools/${encodeURIComponent(toolId)}`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
  await dismissOnboardingIfVisible(page);
  await page.waitForTimeout(600);
};

const runFileTool = async ({
  page,
  toolId,
  filePath,
  screenshotName,
  timeoutMs = 120000,
}) => {
  await openToolPage(page, toolId);
  const input = page.locator("input[type='file']").first();
  await input.setInputFiles(filePath);
  await waitForStandaloneDone(page, timeoutMs);
  const screenshotPath = path.join(outDir, screenshotName);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
};

const runGenerateImageImg2Img = async ({ page, imagePath }) => {
  await openToolPage(page, "generate.image");
  const prompt =
    "Keep the main subject from the reference image, then render a compact black-background dynamic-island style icon.";

  const textarea = page.locator("textarea").first();
  await textarea.fill(prompt);

  const fileInput = page.locator("input[type='file']").first();
  await fileInput.setInputFiles(imagePath);

  const beforePath = path.join(outDir, "01-img2img-before-run.png");
  await page.screenshot({ path: beforePath, fullPage: true });

  const runButton = page
    .locator("button")
    .filter({ hasText: /Run/i })
    .first();
  await runButton.click();

  await page.waitForSelector("img[alt]", { timeout: 240000 });
  const bodyText = await page.locator("body").innerText();
  if (textHasFailure(bodyText)) {
    throw new Error(`generate.image failed: ${bodyText.slice(0, 400)}`);
  }

  const afterPath = path.join(outDir, "02-img2img-after-run.png");
  await page.screenshot({ path: afterPath, fullPage: true });

  return { beforePath, afterPath, prompt };
};

const main = async () => {
  fs.mkdirSync(outDir, { recursive: true });

  const pngPath = path.join(fixtureDir, "sample.png");
  const pdfPath = path.join(fixtureDir, "sample.pdf");
  const docxPath = path.join(fixtureDir, "sample.docx");
  mustExist(pngPath);
  mustExist(pdfPath);
  mustExist(docxPath);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
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
    const img2img = await runGenerateImageImg2Img({ page, imagePath: pngPath });
    const imageConvert = await runFileTool({
      page,
      toolId: "image.convert",
      filePath: pngPath,
      screenshotName: "03-image-convert-png-upload.png",
    });
    const imageCompress = await runFileTool({
      page,
      toolId: "image.compress",
      filePath: pngPath,
      screenshotName: "04-image-compress-png-upload.png",
    });
    const pdfCompress = await runFileTool({
      page,
      toolId: "pdf.compress",
      filePath: pdfPath,
      screenshotName: "05-pdf-compress-upload.png",
    });
    const wordExtract = await runFileTool({
      page,
      toolId: "word.extract_text",
      filePath: docxPath,
      screenshotName: "06-word-extract-upload.png",
    });

    const report = {
      appBaseUrl,
      generatedAt: new Date().toISOString(),
      outDir,
      fixtures: { pngPath, pdfPath, docxPath },
      screenshots: {
        img2imgBefore: img2img.beforePath,
        img2imgAfter: img2img.afterPath,
        imageConvert,
        imageCompress,
        pdfCompress,
        wordExtract,
      },
      img2imgPrompt: img2img.prompt,
    };
    const reportPath = path.join(outDir, "00-window-upload-report.json");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

    console.log(`[window-proof] outDir=${outDir}`);
    console.log(`[window-proof] report=${reportPath}`);
    console.log("[window-proof] PASS");
  } finally {
    await browser.close();
  }
};

main().catch((error) => {
  console.error("[window-proof] FAIL", error?.message || error);
  process.exitCode = 1;
});

