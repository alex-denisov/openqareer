import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { preview } from 'vite';

const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'mobile-390', width: 390, height: 844 },
];
const OUT = 'output/playwright';
const CANDIDATE = {
  username: 'candidate.first-run',
  email: 'candidate.first-run@example.test',
  displayName: 'First Run Candidate',
  role: 'candidate',
  isTest: true,
  emailVerified: true,
  candidateId: 'candidate-first-run-source',
};
const CONNECTIONS = [
  { platform: 'linkedin', available: true, status: 'disconnected', capabilities: ['profile_read'] },
  { platform: 'hh', available: true, status: 'disconnected', capabilities: ['resume_read'] },
];

/**
 * A saved goal lives in sessionStorage until the wizard ends (block A 30.10):
 * a reload in the same tab resumes at «Источник», so the goal step is passed only once.
 */
async function passGoalStep(page) {
  await page.getByTestId('first-run-wizard').waitFor({ timeout: 20_000 });
  if (!(await page.evaluate(() => sessionStorage.getItem('openqareer.firstRun.goal')))) {
    await page.getByTestId('goal-textarea').fill('Хочу найти работу по своему опыту.');
    await page.getByTestId('save-goal-btn').click();
  }
  await page.getByTestId('source-opt-linkedin').waitFor({ timeout: 10_000 });
}

async function verifySourceActions(page, viewport, baseUrl) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(`${baseUrl}/app`, { waitUntil: 'domcontentloaded' });
  await passGoalStep(page);
  for (const source of ['linkedin', 'hh', 'file', 'talk']) {
    if ((await page.getByTestId(`source-opt-${source}`).count()) !== 1) {
      throw new Error(`${viewport.name}: missing source option ${source}`);
    }
  }
  const row = page.getByTestId('source-opt-linkedin');
  await row.click();
  if (viewport.width <= 760) await page.getByTestId('source-next-btn').click();
  await page.locator('.career-account-screen').waitFor({ timeout: 10_000 });
  const connection =
    viewport.width <= 760
      ? page.locator('.career-account-mobile-row').filter({ hasText: 'LinkedIn' })
      : page.locator('.career-account-row').filter({ hasText: 'LinkedIn' });
  await connection.getByText('Не подключено', { exact: true }).waitFor();
  // B464 (24.10): the browser cannot finish a platform sign-in, so it shows no sign-in button.
  if ((await connection.getByRole('button', { name: /Открыть окно входа/u }).count()) > 0) {
    throw new Error(`${viewport.name}: the browser offers a sign-in window it cannot finish`);
  }
  await page.screenshot({ path: `${OUT}/first-run-source-${viewport.name}-connections.png` });
}

async function verifyUploadMenu(page, viewport, baseUrl) {
  await page.goto(`${baseUrl}/app`, { waitUntil: 'domcontentloaded' });
  await passGoalStep(page);
  if (viewport.width > 760) {
    // B538: on 1440 «Файл резюме → Загрузить» opens the system file picker at once, without the 390 menu.
    const chooser = page.waitForEvent('filechooser', { timeout: 10_000 });
    await page.getByTestId('source-opt-file').click();
    await page
      .getByRole('button', { name: 'Загрузить', exact: true })
      .click({ timeout: 2_000 })
      .catch(() => undefined);
    await chooser;
    await page.getByTestId('pick-photo-btn').waitFor({ state: 'hidden' });
    await page.screenshot({ path: `${OUT}/first-run-source-${viewport.name}-file-picker.png` });
    return;
  }
  await page.getByTestId('source-opt-file').click();
  await page.getByTestId('source-next-btn').click();
  // Photo and scan open the same file picker; no «unavailable» notice (owner rule 24.10).
  for (const testId of ['pick-photo-btn', 'scan-doc-btn']) {
    const chooser = page.waitForEvent('filechooser', { timeout: 5_000 });
    await page.getByTestId(testId).click();
    await chooser;
  }
  if ((await page.getByText(/пока недоступн/u).count()) > 0) {
    throw new Error('first-run upload menu still shows an «unavailable» notice');
  }
  await page.screenshot({ path: `${OUT}/first-run-source-${viewport.name}-file-menu.png` });
}

async function stubWizardApi(page) {
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/v1/auth/me') return route.fulfill({ json: { data: CANDIDATE } });
    if (pathname === '/api/v1/candidate/workspace') return route.fulfill({ json: { data: null } });
    if (pathname === '/api/v1/candidate/connections')
      return route.fulfill({ json: { data: CONNECTIONS } });
    if (pathname === '/api/v1/account')
      return route.fulfill({
        json: {
          data: {
            username: CANDIDATE.username,
            email: CANDIDATE.email,
            displayName: CANDIDATE.displayName,
            profile: { headline: '', location: '', workMode: 'hybrid' },
            sessions: [],
          },
        },
      });
    return route.fulfill({ json: { data: null } });
  });
}

async function run() {
  await mkdir(OUT, { recursive: true });
  const server = await preview({ logLevel: 'silent', preview: { host: '127.0.0.1', port: 0 } });
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('preview did not expose a port');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const viewport of VIEWPORTS) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
      });
      await stubWizardApi(page);
      await page.goto(`${baseUrl}/app`, { waitUntil: 'domcontentloaded' });
      await passGoalStep(page);
      await verifySourceActions(page, viewport, baseUrl);
      await verifyUploadMenu(page, viewport, baseUrl);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      results.push({ viewport: viewport.name, horizontalOverflow: overflow });
      await page.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
  const overflow = results.filter((result) => result.horizontalOverflow > 1);
  process.stdout.write(`${JSON.stringify({ results, overflow }, null, 2)}\n`);
  process.stdout.write(`first-run-source-step: ${overflow.length ? 'FAIL' : 'pass'}\n`);
  if (overflow.length) process.exitCode = 1;
}

await run();
