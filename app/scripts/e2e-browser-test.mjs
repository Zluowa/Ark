import { chromium } from "playwright";

const log = (msg) => console.log(msg);
const BASE = "http://localhost:3010";

async function dismissOnboarding(page) {
  const skipBtn = page.locator("button:has-text('跳过')");
  if (await skipBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await skipBtn.click();
    await page.waitForTimeout(500);
  }
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

// Capture console errors
page.on("console", (msg) => {
  if (msg.type() === "error") log("[CONSOLE ERROR] " + msg.text());
});
page.on("pageerror", (err) => log("[PAGE ERROR] " + err.message));

try {
  // 1. Setup
  log("=== 1. Setup ===");
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle", timeout: 30000 });
  await dismissOnboarding(page);
  await page.evaluate(() => localStorage.setItem("onboarding_completed", "true"));

  // 2. Ensure disconnected
  log("=== 2. Ensure Disconnected ===");
  const statusRes = await page.evaluate(() => fetch("/api/v1/connections").then(r => r.json()));
  const xhsConn = statusRes.connections?.find(c => c.provider === "xhs");
  log("XHS status: " + (xhsConn?.status ?? "unknown"));
  if (xhsConn?.status && xhsConn.status !== "none") {
    await page.evaluate(() => fetch("/api/v1/connections/xhs", { method: "DELETE" }).then(r => r.json()));
    log("Disconnected");
    await page.waitForTimeout(500);
  }

  // 3. Fresh connections page
  log("=== 3. Connections ===");
  await page.goto(`${BASE}/dashboard/connections`, { waitUntil: "networkidle", timeout: 30000 });
  await dismissOnboarding(page);
  await page.waitForTimeout(1500);
  await page.locator("button:has-text('All')").first().click();
  await page.waitForTimeout(1000);

  // 4. XHS Auth
  log("=== 4. XHS Auth ===");
  const xhsCard = page.locator('[role="button"]').filter({ hasText: "小红书" }).first();
  const connectBtn = xhsCard.locator("button", { hasText: "+ 连接" }).first();
  const btnVisible = await connectBtn.isVisible({ timeout: 3000 }).catch(() => false);
  log("'+ 连接' visible: " + btnVisible);

  if (!btnVisible) {
    log("ERROR: Button not found");
    await page.screenshot({ path: "/tmp/e2e-fail.png", fullPage: true });
  } else {
    await connectBtn.click({ force: true });
    log("Clicked '+ 连接'");

    const dialog = page.locator("[role='dialog']");
    await dialog.first().waitFor({ state: "visible", timeout: 10000 });
    log("Dialog opened");

    // Wait a moment for fetch to complete + React to re-render
    await page.waitForTimeout(3000);

    // Debug: dump dialog text content
    const dialogText = await dialog.first().innerText().catch(() => "");
    log("Dialog text: " + JSON.stringify(dialogText.replace(/\n+/g, " | ")));

    // Check what phase we're in
    const hasBrowserOpen = await dialog.locator("text=登录窗口已打开").count() > 0;
    const hasQrImage = (await dialog.locator("img[alt='XHS QR Code']").count()) > 0;
    const hasSpinner = (await dialog.locator(".animate-spin").count()) > 0;
    const hasFailed = (await dialog.locator("text=连接失败").count()) > 0;

    log("States — browser-open: " + hasBrowserOpen + ", qr: " + hasQrImage + ", spinner: " + hasSpinner + ", failed: " + hasFailed);

    if (hasBrowserOpen) {
      log("SUCCESS: Headed mode — '登录窗口已打开'");
      await page.screenshot({ path: "/tmp/e2e-headed.png", fullPage: false });
    } else if (hasQrImage) {
      log("SUCCESS: Headless mode — QR displayed");
      await page.screenshot({ path: "/tmp/e2e-headless.png", fullPage: false });
    } else {
      log("INVESTIGATING: Waiting longer...");
      // Wait for any state change (up to 15 more seconds)
      try {
        await page.waitForFunction(
          () => document.querySelector("[role='dialog']")?.textContent?.includes("登录窗口已打开") ||
                document.querySelector("[role='dialog']")?.textContent?.includes("连接失败") ||
                document.querySelector("[role='dialog'] img[alt='XHS QR Code']"),
          { timeout: 15000 },
        );
        const finalText = await dialog.first().innerText().catch(() => "");
        log("Final dialog text: " + JSON.stringify(finalText.replace(/\n+/g, " | ")));
      } catch {
        log("Timed out waiting for state change");
      }
      await page.screenshot({ path: "/tmp/e2e-result.png", fullPage: false });
    }
  }

  log("\n=== DONE ===");
} finally {
  await browser.close();
}
