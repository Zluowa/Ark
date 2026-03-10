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
  const count = await page.locator('input[type="file"]').count();
  console.log('count=', count);
  for (let i = 0; i < count; i += 1) {
    const html = await page.locator('input[type="file"]').nth(i).evaluate((el) => el.outerHTML);
    console.log(`input${i}=`, html);
  }
  await browser.close();
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
