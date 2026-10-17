import { advanceFirstRunSource } from '../e2e/helpers/advance-first-run-source.mjs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { preview } from 'vite';

const OUT = '/Users/alexeydenisov/Projects/openqareer/docs/v1-release/tasks/evidence/S11-WIZ';
const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
];
const USER = {
  username: 'first-run.screenshots',
  email: 'first-run.screenshots@example.test',
  displayName: 'First Run Candidate',
  role: 'candidate',
  isTest: true,
  emailVerified: true,
  candidateId: 'candidate-first-run-screenshots',
};

async function stubApi(page) {
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      if (pathname === '/api/v1/auth/me') return route.fulfill({ json: { data: USER } });
      if (pathname === '/api/v1/candidate/workspace') {
        if (request.method() === 'PUT') {
          return route.fulfill({ json: { data: request.postDataJSON()?.workspace ?? null } });
        }
        return route.fulfill({ json: { data: null } });
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

async function captureViewport(browser, baseUrl, viewport) {
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
  });
  await stubApi(page);
  await page.goto(`${baseUrl}app`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('first-run-wizard').waitFor({ timeout: 20_000 });
  await page.getByTestId('goal-textarea').fill('Хочу найти работу по своему опыту.');
  await page.getByTestId('save-goal-btn').click();
  await page.screenshot({ path: `${OUT}/first-run-source-${viewport.name}.png` });
  await advanceFirstRunSource(page, viewport.width <= 760);
  await page.getByTestId('context-submit-btn').waitFor({ timeout: 10_000 });
  await page.screenshot({ path: `${OUT}/first-run-context-${viewport.name}.png` });
  await page.close();
}

await mkdir(OUT, { recursive: true });
const server = await preview({ logLevel: 'silent', preview: { host: '127.0.0.1', port: 0 } });
const address = server.httpServer.address();
if (!address || typeof address === 'string') throw new Error('preview did not expose a port');
const browser = await chromium.launch();
try {
  const baseUrl = `http://127.0.0.1:${address.port}/`;
  for (const viewport of VIEWPORTS) await captureViewport(browser, baseUrl, viewport);
} finally {
  await browser.close();
  await server.close();
}
process.stdout.write('first-run-shots: pass\n');
