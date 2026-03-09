import { chromium } from "playwright";

const main = async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  await page.addInitScript(() => {
    window.localStorage.setItem("omniagent-onboarding-complete", "true");
  });
  await page.goto("http://127.0.0.1:3010/dashboard/tools/image.iopaint_studio", {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.locator('input[type="file"]').nth(0).setInputFiles(
    "D:/Moss/projects/omniagent-new/app/test-screenshots/2026-03-07-iopaint-studio-proof/00-source-watermark.png",
  );
  await page.waitForTimeout(5000);
  console.log("imgCount=", await page.locator('img[alt="IOPaint studio source"]').count());
  console.log("body=", (await page.locator("body").innerText()).slice(0, 1200));
  await page.screenshot({
    path: "D:/Moss/projects/omniagent-new/app/test-screenshots/2026-03-07-iopaint-studio-proof/01-debug-upload.png",
    fullPage: true,
    animations: "disabled",
  });
  await browser.close();
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
