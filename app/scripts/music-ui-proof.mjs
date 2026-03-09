import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const outDir = "D:\\Moss\\projects\\omniagent-new\\app\\test-screenshots\\2026-03-07-music-ui-proof";
mkdirSync(outDir, { recursive: true });

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 1 });

  await page.goto("http://127.0.0.1:3010/test-widgets", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(2500);

  const widget = page.locator("#w-music");
  await widget.waitFor({ state: "visible", timeout: 30000 });
  await widget.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);

  const searchInput = widget.locator('input[placeholder="Search or switch track"]').first();
  await searchInput.fill("Taylor");
  await searchInput.press("Enter");
  await page.waitForTimeout(2500);

  const firstSong = widget.locator("button").filter({ hasText: /Taylor Swift|Cruel Summer|Anti-Hero/i }).first();
  if (await firstSong.count()) {
    await firstSong.click();
    await page.waitForTimeout(1800);
  }

  const shot = path.join(outDir, "10-web-music-surface.png");
  await widget.screenshot({ path: shot });

  const report = {
    outputDir: outDir,
    screenshot: shot,
    url: "http://127.0.0.1:3010/test-widgets",
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  await browser.close();
}

main().catch((error) => {
  console.error("[music-ui-proof] FAIL", error);
  process.exitCode = 1;
});

