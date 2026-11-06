import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { preview } from 'vite';

/**
 * B589: opens `dist-desktop` the way the .app window does and walks to the
 * cabinet. The Playwright suite serves `dist` only, so it cannot see a file
 * missing from this folder.
 */
const DESKTOP_DIST = process.argv[2] ?? 'dist-desktop';
const LANDING_TEXT = /Вы выбираете работу/u;
const CRASH_TEXT = /Что-то пошло не так/u;
const SIGN_IN_TEXT = /Вход в кабинет/u;
const SESSION = {
  username: 'candidate.test',
  role: 'candidate',
  isTest: true,
  candidateId: 'candidate-desktop-shell',
};
const VIEWPORT = { width: 1176, height: 800 };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** Enough of Tauri for the app to believe it is in the window. */
function fakeTauri() {
  window.__TAURI_INTERNALS__ = {
    invoke: async () => null,
    transformCallback: () => 0,
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
  };
}

function json(route, status, data) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ data }),
  });
}

function watchForProblems(page) {
  const problems = [];
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && /preload|Failed to fetch dynamically/iu.test(message.text()))
      problems.push(`console: ${message.text()}`);
  });
  // The preview server can answer a missing file with index.html and 200, and
  // Chromium lets that pass for a stylesheet. HTML under /assets/ is a missing file.
  page.on('response', (response) => {
    const { pathname } = new URL(response.url());
    if (!pathname.startsWith('/assets/')) return;
    const type = response.headers()['content-type'] ?? '';
    if (response.status() >= 400 || type.includes('text/html'))
      problems.push(`missing ${pathname} (${response.status()} ${type})`);
  });
  return problems;
}

async function walk(browser, origin, { path, signedIn }) {
  const context = await browser.newContext({ viewport: VIEWPORT, reducedMotion: 'reduce' });
  await context.addInitScript(fakeTauri);
  const page = await context.newPage();
  const problems = watchForProblems(page);
  const painted = [];
  await context.exposeBinding('reportPaint', (_source, text) => painted.push(text));
  await context.addInitScript(() => {
    const report = () => window.reportPaint?.(document.body?.innerText ?? '');
    new MutationObserver(report).observe(document, { childList: true, subtree: true });
  });
  await page.route(
    (url) => url.origin !== origin,
    (route) => route.abort(),
  );
  await page.route('**/api/**', (route) => {
    const isAuth = new URL(route.request().url()).pathname.startsWith('/api/v1/auth');
    if (isAuth) return json(route, 200, signedIn ? SESSION : null);
    return json(route, signedIn ? 200 : 401, null);
  });
  await page.goto(`${origin}${path}`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => document.getElementById('root')?.childElementCount > 0,
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(2_000);
  const text = await page.locator('body').innerText();
  assert(problems.length === 0, `${path}: ${problems.join('; ')}`);
  assert(!CRASH_TEXT.test(text), `${path}: the error screen is shown`);
  assert(!painted.some((frame) => LANDING_TEXT.test(frame)), `${path}: the landing was painted`);
  if (signedIn) {
    const shown = await page.getByTestId('career-shell').isVisible();
    assert(shown, `${path}: the cabinet did not render: ${text.slice(0, 200)}`);
  } else {
    assert(SIGN_IN_TEXT.test(text), `${path}: no sign-in form: ${text.slice(0, 200)}`);
  }
  await context.close();
  return { path, signedIn, frames: painted.length };
}

const rawIndex = await readFile(`${DESKTOP_DIST}/index.html`, 'utf8');
assert(/<div id="root"[^>]*><\/div>/u.test(rawIndex), 'index.html: #root is not empty');
assert(!LANDING_TEXT.test(rawIndex), 'index.html: landing text');

const server = await preview({
  logLevel: 'silent',
  build: { outDir: DESKTOP_DIST },
  preview: { host: '127.0.0.1', port: 0 },
});
const address = server.httpServer.address();
const browser = await chromium.launch();
try {
  assert(address && typeof address !== 'string', 'preview server did not expose a local port');
  const origin = `http://127.0.0.1:${address.port}`;
  const results = [];
  for (const signedIn of [false, true]) {
    for (const path of ['/', '/app']) results.push(await walk(browser, origin, { path, signedIn }));
  }
  process.stdout.write(`${JSON.stringify({ status: 'pass', results })}\n`);
} finally {
  await browser.close();
  await server.close();
}
