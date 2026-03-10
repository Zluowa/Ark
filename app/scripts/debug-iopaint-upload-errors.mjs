import { chromium } from "playwright";

const main = async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  page.on("console", (msg) => console.log("console:", msg.type(), msg.text()));
  page.on("pageerror", (err) => console.log("pageerror:", err.message));
  await page.addInitScript(() => {
    window.localStorage.setItem("omniagent-onboarding-complete", "true");
  });
  await page.goto("http://127.0.0.1:3010/dashboard/tools/image.iopaint_studio", {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  const input = page.locator('input[type="file"]').nth(0);
  console.log("inputCount=", await page.locator('input[type="file"]').count());
  await input.setInputFiles("D:/Moss/projects/omniagent-new/app/test-screenshots/2026-03-07-iopaint-studio-proof/00-source-watermark.png");
  await page.waitForTimeout(5000);
  console.log("imgCount=", await page.locator('img[alt="IOPaint studio source"]').count());
  await browser.close();
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
