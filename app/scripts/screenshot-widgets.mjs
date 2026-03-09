// @input: none
// @output: screenshots of all 10 new widgets + full page
// @position: QA test script

import { chromium } from "playwright";
import { mkdirSync } from "fs";

const OUT = "screenshots";
mkdirSync(OUT, { recursive: true });

const WIDGETS = [
  { id: "w-tldraw",    name: "30-tldraw-canvas" },
  { id: "w-flow",      name: "31-flow-editor" },
  { id: "w-blocknote", name: "32-block-editor" },
  { id: "w-novel",     name: "33-novel-editor" },
  { id: "w-sandpack",  name: "34-sandpack-sandbox" },
  { id: "w-converter", name: "35-file-converter" },
  { id: "w-univer",    name: "36-univer-sheet" },
  { id: "w-tremor",    name: "37-tremor-dashboard" },
  { id: "w-graph",     name: "38-graph-viewer" },
  { id: "w-mantine",   name: "39-mantine-toolkit" },
];

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  console.log("Navigating to test-widgets...");
  await page.goto("http://localhost:3010/test-widgets", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(5000);

  // Full page screenshot
  console.log("Taking full page screenshot...");
  await page.screenshot({ path: `${OUT}/00-full-page.png`, fullPage: true });
  console.log("✓ Full page saved");

  // Individual widget screenshots
  for (const w of WIDGETS) {
    try {
      const el = page.locator(`#${w.id}`);
      const count = await el.count();
      if (count === 0) {
        console.log(`✗ ${w.name} — element #${w.id} NOT FOUND`);
        continue;
      }
      await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(2000);
      await el.screenshot({ path: `${OUT}/${w.name}.png` });
      console.log(`✓ ${w.name} — screenshot saved`);
    } catch (err) {
      console.log(`✗ ${w.name} — ERROR: ${err.message}`);
    }
  }

  await browser.close();
  console.log("\nDone! Screenshots in ./screenshots/");
}

main().catch(console.error);
