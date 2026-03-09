import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const appBaseUrl =
  process.env.OMNIAGENT_APP_BASE_URL?.trim() || "http://127.0.0.1:3010";

const rootDir = path.resolve(process.cwd(), "..");
const reviewDir = path.join(
  rootDir,
  "review-screenshots",
  "2026-03-07-stack-web-island-round",
);
const fixtureDir = path.join(process.cwd(), "test-fixtures", "window-upload-proof");

const failPattern =
  /upload failed|execution failed|invalid api key|missing api key|missing required parameters|unauthorized|tool page reported failure|\berror:\b/i;

const mustExist = (filePath) => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing fixture: ${filePath}`);
  }
};

const dismissOnboardingIfVisible = async (page) => {
  const skip = page.locator("button").filter({ hasText: /skip/i }).first();
  if (await skip.isVisible({ timeout: 800 }).catch(() => false)) {
    await skip.click({ force: true });
    await page.waitForTimeout(300);
  }
};

const assertNoFailureText = async (page, label) => {
  const text = await page.locator("body").innerText();
  if (failPattern.test(text)) {
    throw new Error(`${label} failed: ${text.slice(0, 600)}`);
  }
};

const searchInput = (page) =>
  page.getByPlaceholder("Search a tool or action").first();

const selectTool = async (page, query, toolName) => {
  const input = searchInput(page);
  await input.fill(query);
  const card = page.getByRole("button", { name: new RegExp(toolName, "i") }).first();
  await card.waitFor({ state: "visible", timeout: 20000 });
  await card.click();
  await page.waitForFunction(
    (expected) => document.body?.innerText?.includes(expected),
    toolName,
    { timeout: 20000 },
  );
};

const screenshot = async (page, filename) => {
  const target = path.join(reviewDir, filename);
  await page.screenshot({ path: target, fullPage: true });
  return target;
};

const readExistingReport = (reportPath) => {
  if (!fs.existsSync(reportPath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(reportPath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return {};
  }
};

const openConsoleTab = async (page, label) => {
  const tab = page.getByRole("button", { name: new RegExp(label, "i") }).first();
  await tab.waitFor({ state: "visible", timeout: 20000 });
  await tab.click();
  await page.waitForTimeout(300);
};

const main = async () => {
  fs.mkdirSync(reviewDir, { recursive: true });

  const pngPath = path.join(fixtureDir, "sample.png");
  const pdfPath = path.join(fixtureDir, "sample.pdf");
  mustExist(pngPath);
  mustExist(pdfPath);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1400 },
    deviceScaleFactor: 1,
  });

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.error(`[browser-error] ${msg.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    console.error(`[pageerror] ${error.message}`);
  });

  await page.addInitScript(() => {
    localStorage.setItem("omniagent-onboarding-complete", "true");
    localStorage.setItem(
      "omniagent-locale",
      JSON.stringify({ state: { locale: "en" }, version: 0 }),
    );
  });

  try {
    await page.goto(`${appBaseUrl}/dashboard/tools`, {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    await dismissOnboardingIfVisible(page);
    await page.waitForFunction(
      () => document.body?.innerText?.includes("One surface for every tool run."),
      { timeout: 30000 },
    );
    await assertNoFailureText(page, "stack overview");

    const screenshots = {};
    screenshots.overview = await screenshot(page, "01-web-overview.png");

    await selectTool(page, "json", "JSON to YAML");
    await assertNoFailureText(page, "catalog search");
    const jsonInput = page.locator("#tool-input-convert-json_yaml-input");
    await jsonInput.fill('{"app":"OmniAgent","mode":"stack","proof":true}');
    await page.getByRole("button", { name: /run now/i }).first().click();
    await page.waitForFunction(
      () => document.body?.innerText?.includes("app: OmniAgent"),
      { timeout: 30000 },
    );
    await assertNoFailureText(page, "sync text run");
    await openConsoleTab(page, "result");
    screenshots.result = await screenshot(page, "02-web-console-result.png");

    await selectTool(page, "file compress", "File Compress");
    const fileInputs = page.locator("input[type='file']");
    await fileInputs.first().setInputFiles([pngPath, pdfPath]);
    await page.waitForFunction(
      () => {
        const field = document.querySelector(
          "#tool-input-file-compress-file_urls",
        );
        return Boolean(field && "value" in field && field.value.includes("http"));
      },
      { timeout: 30000 },
    );
    await page.getByRole("button", { name: /run now/i }).first().click();
    await page.waitForFunction(
      () => document.body?.innerText?.includes("Output file"),
      { timeout: 120000 },
    );
    await assertNoFailureText(page, "file run");

    await selectTool(page, "markdown", "Markdown to HTML");
    const markdownInput = page.locator("#tool-input-convert-md_html-input");
    const markdown = "# Async stack proof\n\n- queue\n- observe\n- complete";
    await markdownInput.fill(markdown);
    await page.getByRole("button", { name: /queue job/i }).first().click();
    await page.waitForFunction(
      () => {
        const text = document.body?.innerText ?? "";
        return (
          text.includes("queued") ||
          text.includes("processing") ||
          text.includes("completed")
        );
      },
      { timeout: 30000 },
    );
    await page.waitForFunction(
      () => document.body?.innerText?.includes("completed"),
      { timeout: 120000 },
    );
    await page.waitForFunction(
      () => {
        const text = document.body?.innerText ?? "";
        return text.includes("Async stack proof") && text.includes("completed");
      },
      { timeout: 30000 },
    );
    await assertNoFailureText(page, "async run");
    await openConsoleTab(page, "job");
    screenshots.job = await screenshot(page, "03-web-console-job.png");

    await openConsoleTab(page, "history");
    const reuseButton = page.getByRole("button", { name: /reuse inputs/i }).first();
    await reuseButton.scrollIntoViewIfNeeded();
    await reuseButton.click();
    await page.waitForFunction(
      () => {
        const field = document.querySelector("#tool-input-convert-md_html-input");
        if (!field || !("value" in field)) return false;
        const value = String(field.value);
        return (
          value.includes("Async stack proof") &&
          value.includes("queue") &&
          value.includes("complete")
        );
      },
      { timeout: 10000 },
    );
    screenshots.history = await screenshot(page, "04-web-console-history.png");

    const reportPath = path.join(reviewDir, "report.json");
    const report = readExistingReport(reportPath);
    report.web = {
      appBaseUrl,
      generatedAt: new Date().toISOString(),
      fixtures: {
        pngPath,
        pdfPath,
      },
      screenshots,
      tools: {
        sync: "convert.json_yaml",
        file: "file.compress",
        async: "convert.md_html",
      },
    };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

    console.log(`[stack-workbench-proof] reviewDir=${reviewDir}`);
    console.log(`[stack-workbench-proof] report=${reportPath}`);
    console.log("[stack-workbench-proof] PASS");
  } finally {
    await browser.close();
  }
};

main().catch((error) => {
  console.error("[stack-workbench-proof] FAIL", error?.message || error);
  process.exitCode = 1;
});
