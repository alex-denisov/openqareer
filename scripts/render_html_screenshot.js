import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { preview } from 'vite';

const host = '127.0.0.1';
const port = 4174;
const outputDir = path.resolve('output/playwright');
const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.httpServer.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function renderViewport(browser, viewport) {
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
    reducedMotion: 'reduce',
  });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console:${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`page:${error.message}`));
  page.on('requestfailed', (request) => {
    errors.push(`request:${new URL(request.url()).pathname}`);
  });
  await page.route('**/api/v1/auth/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: null }),
    });
  });
  await page.goto(`http://${host}:${port}/?render-shot=${viewport.name}`, {
    waitUntil: 'domcontentloaded',
  });
  const shell = page.getByTestId('career-shell');
  await shell.waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForFunction(
    () => !document.getElementById('root')?.hasAttribute('aria-busy'),
    undefined,
    { timeout: 15_000 },
  );
  assert(
    (await page.getByText('Загружаем рабочее пространство').count()) === 0,
    `${viewport.name}: render-shot captured a loading-only shell`,
  );
  assert(
    (await shell.evaluate((element) => getComputedStyle(element).display)) === 'grid',
    `${viewport.name}: production CSS was not applied`,
  );
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  assert(overflow <= 1, `${viewport.name}: horizontal overflow is ${overflow}px`);
  assert(errors.length === 0, `${viewport.name}: ${errors.join(', ')}`);
  const outputPath = path.join(outputDir, `render-shot-${viewport.name}.png`);
  await page.screenshot({ path: outputPath, fullPage: true });
  await page.close();
  return { viewport: viewport.name, outputPath, overflow };
}

async function renderScreenshots() {
  await mkdir(outputDir, { recursive: true });
  const server = await preview({ preview: { host, port, strictPort: true } });
  const browser = await chromium.launch({ headless: true });
  try {
    const outputs = [];
    for (const viewport of viewports) outputs.push(await renderViewport(browser, viewport));
    console.log(JSON.stringify({ renderShot: 'ready', outputs }));
  } finally {
    await browser.close();
    await closeServer(server);
  }
}

renderScreenshots().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
