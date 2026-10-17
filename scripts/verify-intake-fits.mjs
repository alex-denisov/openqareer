import { advanceFirstRunSource } from '../e2e/helpers/advance-first-run-source.mjs';
import { mkdir } from 'node:fs/promises';
import { preview } from 'vite';
import { chromium } from 'playwright';

const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'narrow-320', width: 320, height: 844 },
];
const OUT = 'output/playwright';
const CANDIDATE = {
  username: 'candidate.first-run',
  email: 'candidate.first-run@example.test',
  displayName: 'First Run Candidate',
  role: 'candidate',
  isTest: true,
  emailVerified: true,
  candidateId: 'candidate-first-run-fit',
};

async function stubFirstRunApi(page) {
  let workspace = null;
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      if (pathname === '/api/v1/auth/me') return route.fulfill({ json: { data: CANDIDATE } });
      if (pathname === '/api/v1/candidate/workspace' && request.method() === 'PUT') {
        const payload = request.postDataJSON();
        workspace = payload?.workspace ?? payload;
        return route.fulfill({ json: { data: workspace } });
      }
      if (pathname === '/api/v1/candidate/workspace') {
        return route.fulfill({ json: { data: workspace } });
      }
      if (pathname === '/api/v1/candidate/connections') {
        return route.fulfill({
          json: {
            data: [
              { platform: 'linkedin', available: true, status: 'disconnected' },
              { platform: 'hh', available: true, status: 'disconnected' },
            ],
          },
        });
      }
      if (pathname.endsWith('/candidate/me/messages')) return route.fulfill({ json: { data: [] } });
      if (pathname.endsWith('/candidate/me')) return route.fulfill({ json: { data: null } });
      return route.fulfill({ json: { data: null } });
    },
  );
}

async function measure(page, name) {
  return page.evaluate((label) => {
    const doc = document.documentElement;
    const main = doc.querySelector('#career-main');
    return {
      name: label,
      viewport: { width: innerWidth, height: innerHeight },
      documentOverflow: doc.scrollHeight - doc.clientHeight,
      mainOverflow: main ? main.scrollHeight - main.clientHeight : null,
      horizontalOverflow: doc.scrollWidth - doc.clientWidth,
      mobileState: doc
        .querySelector('[data-testid="first-run-wizard"]')
        ?.getAttribute('data-mobile'),
    };
  }, name);
}

async function walkFirstRun(page, baseUrl, viewport, results) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await stubFirstRunApi(page);
  await page.goto(`${baseUrl}app`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('first-run-wizard').waitFor({ timeout: 20_000 });
  await page.getByTestId('goal-textarea').fill('Хочу найти работу по своему опыту.');
  await page.getByTestId('save-goal-btn').click();
  results.push(await measure(page, `${viewport.name}-source`));
  await page.screenshot({ path: `${OUT}/first-run-${viewport.name}-source.png` });

  await advanceFirstRunSource(page, viewport.width <= 760);
  await page.getByTestId('context-city-picker-btn').waitFor();
  results.push(await measure(page, `${viewport.name}-context`));
  await page.screenshot({ path: `${OUT}/first-run-${viewport.name}-context.png` });
}

function report(results) {
  const overflow = results.filter((result) => result.horizontalOverflow > 1);
  const desktopScroll = results.filter(
    (result) => result.name.startsWith('desktop') && (result.mainOverflow ?? 0) > 1,
  );
  process.stdout.write(`${JSON.stringify({ results, overflow, desktopScroll }, null, 2)}\n`);
  // The approved desktop source frame is taller than 900px. Vertical scrolling is expected;
  // squeezing it to one viewport would change the approved geometry. The walkthrough reaches
  // the source/context controls; horizontal overflow remains a failure.
  const failed = overflow.length > 0;
  process.stdout.write(`first-run-fits: ${failed ? 'FAIL' : 'pass'}\n`);
  if (failed) process.exitCode = 1;
}

async function run() {
  await mkdir(OUT, { recursive: true });
  const server = await preview({ logLevel: 'silent', preview: { host: '127.0.0.1', port: 0 } });
  const address = server.httpServer.address();
  if (!address || typeof address === 'string')
    throw new Error('preview did not expose a local port');
  const browser = await chromium.launch();
  const results = [];
  try {
    const baseUrl = `http://127.0.0.1:${address.port}/`;
    for (const viewport of VIEWPORTS) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
      });
      await walkFirstRun(page, baseUrl, viewport, results);
      await page.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
  report(results);
}

await run();
