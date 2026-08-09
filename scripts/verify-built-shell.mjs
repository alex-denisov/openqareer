import { chromium } from 'playwright';
import { preview } from 'vite';

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function verifyViewport(browser, baseUrl, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    reducedMotion: 'reduce',
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console:${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`page:${error.message}`));
  page.on('requestfailed', (request) =>
    errors.push(`request:${new URL(request.url()).pathname}`),
  );

  await page.route('**/*.oqpart-000.js', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });

  const startedAt = performance.now();
  await page.goto(`${baseUrl}?built-shell=${viewport.name}`, {
    waitUntil: 'commit',
  });
  const shell = page.getByTestId('career-shell');
  await shell.waitFor({ state: 'visible', timeout: 2_000 });
  const shellMs = Math.round(performance.now() - startedAt);

  assert(
    (await page.locator('[data-bootstrap-shell="true"]').getAttribute('inert')) !== null,
    `${viewport.name}: shared shell was not prerendered before JavaScript`,
  );
  assert(
    (await page.getByRole('heading', { name: 'С чем разобраться?' }).count()) === 1,
    `${viewport.name}: useful first decision is absent from initial HTML`,
  );
  for (const label of ['Сегодня', 'Профиль', 'Карьера', 'Возможности']) {
    assert(
      (await page.locator(`button[aria-label="${label}"]`).count()) >= 2,
      `${viewport.name}: invariant navigation is missing ${label}`,
    );
  }
  assert(
    (await page.getByText('Загружаем рабочее пространство').count()) === 0,
    `${viewport.name}: loading-only copy returned`,
  );

  await page.waitForFunction(
    () => !document.getElementById('root')?.hasAttribute('aria-busy'),
    undefined,
    { timeout: 15_000 },
  );
  const interactiveMs = Math.round(performance.now() - startedAt);
  const tariffsButton = page
    .locator(
      '.career-mobile-tariffs:visible, .career-rail-bottom .career-nav-button:visible',
    )
    .first();
  await tariffsButton.click();
  await page.getByRole('heading', { name: 'Сколько делать за вас' }).waitFor();
  assert(
    (await page.locator('button[aria-label="Профиль"]:visible').count()) === 1,
    `${viewport.name}: Profile disappeared after navigation`,
  );

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  assert(overflow <= 1, `${viewport.name}: horizontal overflow is ${overflow}px`);
  assert(errors.length === 0, `${viewport.name}: ${errors.join(', ')}`);
  await context.close();
  return { viewport: viewport.name, shellMs, interactiveMs, overflow };
}

async function verifyCandidateResult(browser, baseUrl, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    reducedMotion: 'reduce',
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console:${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`page:${error.message}`));
  page.on('requestfailed', (request) =>
    errors.push(`request:${new URL(request.url()).pathname}`),
  );
  await page.addInitScript(() => {
    localStorage.setItem(
      'candidate-workspace',
      JSON.stringify({
        version: 6,
        careerGoal: 'find-job',
        resumeText: '',
        resumeSource: 'text',
        targetDirection: 'Руководитель продукта',
        market: 'ru',
        currentSituation:
          'ПослеСменыПозиционированияСталоЗаметноМеньшеПриглашенийНаИнтервьюИПокаНеПонятноЧтоИменноМешаетСледующемуШагу',
        constraints: 'Удалённая работа, без переезда в ближайшие шесть месяцев.',
        urgency: 'active',
        createdAt: '2026-08-09T17:00:00.000Z',
        updatedAt: '2026-08-09T17:00:00.000Z',
        outcomes: [],
      }),
    );
  });
  await page.goto(`${baseUrl}?candidate-result=${viewport.name}`, {
    waitUntil: 'networkidle',
  });
  await page
    .getByRole('heading', { name: 'Что можно сказать уже сейчас' })
    .waitFor();
  await page.getByText('Цель: найти работу', { exact: true }).waitFor();
  await page
    .getByRole('heading', { name: 'Сначала проверим основу поиска' })
    .waitFor();
  assert(
    (await page
      .getByText('Не вывод: пока нет доказательств опыта', { exact: false })
      .count()) === 1,
    `${viewport.name}: honest free diagnostic is absent`,
  );
  const todayWidth = await page.locator('.career-today-view').evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  if (viewport.name === 'desktop') {
    assert(
      todayWidth >= 760,
      `desktop: candidate result is only ${todayWidth}px wide`,
    );
  }
  await page.locator('button[aria-label="Профиль"]:visible').click();
  await page.getByRole('heading', { name: 'Профиль' }).waitFor();
  const profileOverflow = await page.locator('.career-profile-overview').evaluate(
    (element) => element.scrollWidth - element.clientWidth,
  );
  assert(
    profileOverflow <= 1,
    `${viewport.name}: profile overview clips by ${profileOverflow}px`,
  );
  assert(errors.length === 0, `${viewport.name}: ${errors.join(', ')}`);
  await context.close();
  return { viewport: viewport.name, todayWidth, profileOverflow };
}

const server = await preview({
  logLevel: 'silent',
  preview: { host: '127.0.0.1', port: 0 },
});
const address = server.httpServer.address();
if (!address || typeof address === 'string') {
  await server.close();
  throw new Error('preview server did not expose a local port');
}

const browser = await chromium.launch({ headless: true });
try {
  const baseUrl = `http://127.0.0.1:${address.port}/`;
  const results = [];
  const candidateResults = [];
  for (const viewport of viewports) {
    results.push(await verifyViewport(browser, baseUrl, viewport));
    candidateResults.push(
      await verifyCandidateResult(browser, baseUrl, viewport),
    );
  }
  process.stdout.write(
    `${JSON.stringify({ status: 'pass', results, candidateResults })}\n`,
  );
} finally {
  await browser.close();
  await server.close();
}
