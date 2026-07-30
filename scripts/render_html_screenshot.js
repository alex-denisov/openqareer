import { chromium } from 'playwright';
import path from 'path';

async function renderScreenshot() {
  console.log('🚀 Rendering production build dist/index.html...');
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true
  });

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  
  const distPath = `file://${path.resolve('dist/index.html')}`;
  await page.goto(distPath, { waitUntil: 'load' });
  await page.waitForTimeout(1000);

  const outputPath = '/Users/alexeydenisov/.gemini/antigravity/brain/25d5fabf-ac06-4be3-b419-4eb0bc302a25/rendered_ts_screenshot.jpg';
  await page.screenshot({ path: outputPath, fullPage: false });
  console.log('✅ Screenshot saved from dist build to:', outputPath);

  await browser.close();
}

renderScreenshot().catch(console.error);
