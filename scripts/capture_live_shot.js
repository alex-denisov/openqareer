import { chromium } from 'playwright';

async function captureLive() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const screenshotPath = '/Users/alexeydenisov/.gemini/antigravity/brain/25d5fabf-ac06-4be3-b419-4eb0bc302a25/live_dev_screenshot.png';
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log('Saved screenshot to:', screenshotPath);
  await browser.close();
}

captureLive().catch(console.error);
