/**
 * B169 §2 — proves each wizard step fits the screen it is given.
 *
 * The owner's report was that the wizard scrolls: "визард должен быть весь без
 * скролла, нужно чтобы все элементы помещались на одном моем экране". A
 * scrollbar is measurable, so this asserts it rather than eyeballing it. The
 * built release is served by `vite preview`, exactly as the built-shell gate
 * does, so what is measured is what ships.
 */
import { mkdir } from 'node:fs/promises';
import { preview } from 'vite';
import { chromium } from 'playwright';

const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'laptop-1280', width: 1280, height: 800 },
  // Deliberately shorter than either real target. Font metrics differ between
  // the developer's macOS Chromium and CI's Linux one, and step three used to
  // pass locally at 1280x800 and spill 30px on CI. Holding a viewport nobody
  // actually uses is what turns "it fits" into "it fits with room".
  { name: 'short-1280', width: 1280, height: 720 },
  // Shorter still, and for a different reason. `short-1280` proves the step
  // fits; this one proves it fits *with slack*. B158 passed `short-1280` on
  // macOS with 16px to spare and spilled 14px on CI's Linux Chromium, because
  // the two disagree about font metrics by more than that. Holding 40px of
  // headroom locally is what makes a local pass mean a CI pass.
  { name: 'metrics-1280', width: 1280, height: 680 },
];

/** Anonymous candidate: no session, no workspace, so the wizard owns the screen. */
/**
 * `signedIn` matters for the desktop pass only: outside a browser the app sends
 * an anonymous visitor to the login card instead of the wizard, so the source
 * step with the platform cards is unreachable without a session.
 */
async function stubApi(page, { signedIn = false } = {}) {
  const session = signedIn
    ? {
        username: 'candidate.test',
        role: 'candidate',
        candidateId: 'candidate-intake-fits',
      }
    : null;
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const { pathname } = new URL(route.request().url());
      const body = pathname.startsWith('/api/v1/auth')
        ? JSON.stringify({ data: session })
        : '{"data":null}';
      await route.fulfill({ status: 200, contentType: 'application/json', body });
    },
  );
}

async function measure(page, label, outputDirectory) {
  await page.waitForTimeout(250);
  const box = await page.evaluate(() => {
    const main = document.getElementById('career-main');
    const doc = document.documentElement;
    return {
      documentOverflow: doc.scrollHeight - doc.clientHeight,
      mainOverflow: main ? main.scrollHeight - main.clientHeight : null,
      horizontal: doc.scrollWidth - doc.clientWidth,
    };
  });
  await page.screenshot({ path: `${outputDirectory}/intake-${label}.png` });
  return { label, ...box };
}

/** The web build's three steps, with the source variants that change height. */
async function walkWebWizard(page, viewport, outputDirectory, results) {
  await page.goto(`${page.__baseUrl}app`, { waitUntil: 'load' });
  await page.getByRole('heading', { name: 'С чем разобраться?' }).waitFor({ timeout: 20000 });
  results.push(await measure(page, `${viewport.name}-step1`, outputDirectory));

  await page.getByRole('button', { name: /Хочу найти работу/u }).click();
  await page.getByRole('button', { name: /Продолжить/u }).click();
  await page.getByRole('heading', { name: 'Что уже есть?' }).waitFor({ timeout: 10000 });
  results.push(await measure(page, `${viewport.name}-step2-web`, outputDirectory));

  await page.getByRole('button', { name: 'PDF', exact: true }).first().click();
  results.push(await measure(page, `${viewport.name}-step2-pdf`, outputDirectory));
  await page.getByRole('button', { name: 'Текстом' }).click();
  results.push(await measure(page, `${viewport.name}-step2-text`, outputDirectory));

  await page.getByRole('button', { name: 'Без документов' }).click();
  await page.getByRole('button', { name: /Продолжить/u }).click();
  await page.getByRole('heading', { name: 'Что должно измениться?' }).waitFor({ timeout: 10000 });
  results.push(await measure(page, `${viewport.name}-step3`, outputDirectory));
}

/**
 * The owner's report is specifically about the desktop app: "второй, если
 * особенно подключаются профили, сильно выходит за границы". Only the desktop
 * build draws the platform cards, so the web pass cannot see that step at all.
 */
async function walkDesktopSourceStep(browser, baseUrl, viewport, outputDirectory, results) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    // What `isTauriEnvironment()` reads to decide it is inside the app.
    window.__TAURI_INTERNALS__ = {};
    localStorage.setItem('openqareer_session_token', 'desktop-intake-fits-session');
  });
  await stubApi(page, { signedIn: true });
  await page.goto(`${baseUrl}app`, { waitUntil: 'load' });
  await page.getByRole('heading', { name: 'С чем разобраться?' }).waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: /Хочу найти работу/u }).click();
  await page.getByRole('button', { name: /Продолжить/u }).click();
  await page.getByRole('heading', { name: 'Что уже есть?' }).waitFor({ timeout: 10000 });
  results.push(await measure(page, `${viewport.name}-step2-desktop`, outputDirectory));
  await context.close();
}

async function startPreview() {
  const server = await preview({
    logLevel: 'silent',
    preview: { host: '127.0.0.1', port: 0 },
  });
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') {
    await server.close();
    throw new Error('preview server did not expose a local port');
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}/` };
}

function report(results) {
  const scrolling = results.filter(
    (item) => item.documentOverflow > 1 || (item.mainOverflow ?? 0) > 1,
  );
  const wide = results.filter((item) => item.horizontal > 1);
  process.stdout.write(`${JSON.stringify({ results, scrolling, wide }, null, 2)}\n`);
  if (scrolling.length > 0 || wide.length > 0) {
    process.stdout.write('intake-fits: FAIL\n');
    process.exitCode = 1;
    return;
  }
  process.stdout.write('intake-fits: pass\n');
}

async function run() {
  const outputDirectory = 'output/playwright';
  await mkdir(outputDirectory, { recursive: true });
  const { server, baseUrl } = await startPreview();
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
      });
      const page = await context.newPage();
      page.__baseUrl = baseUrl;
      await stubApi(page);
      await walkWebWizard(page, viewport, outputDirectory, results);
      await context.close();
      await walkDesktopSourceStep(browser, baseUrl, viewport, outputDirectory, results);
    }
  } finally {
    await browser.close();
    await server.close();
  }
  report(results);
}

await run();
