import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { matchedVacancyPage } from './fixtures/readabilityWorkspace';
import { readyVacancyFit } from './fixtures/vacancyFit';
test('B525 factual fit, real enqueue/readback, evidence and alternate ordering', async ({
  page,
}, testInfo) => {
  await mockSignedInCabinet(page, { vacancyTotal: 2 });
  let completed = false;
  const methods: string[] = [];
  const sorts: string[] = [];
  const base = matchedVacancyPage(0, 2);
  const vacancyId = base.data[0]!.cluster.id;
  await page.route('**/api/v1/candidate/matched-vacancies*', (route) => {
    const url = new URL(route.request().url());
    sorts.push(url.searchParams.get('sort') ?? 'fit');
    return route.fulfill({
      json: {
        ...base,
        data: base.data.map((item, index) => ({
          ...item,
          explanation: {
            ...item.explanation,
            levelMatch: 'match',
            fitView:
              index === 0
                ? { state: 'processing', requirements: [] }
                : readyVacancyFit(item.cluster.id),
          },
        })),
      },
    });
  });
  await page.route('**/api/v1/candidate/vacancies/*/fit', (route) => {
    const method = route.request().method();
    methods.push(method);
    if (method === 'POST') {
      return route.fulfill({
        status: 202,
        json: { data: { state: 'processing', requirements: [] } },
      });
    }
    return route.fulfill({
      json: {
        data: completed ? readyVacancyFit(vacancyId) : { state: 'processing', requirements: [] },
      },
    });
  });
  await page.clock.install();
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Вакансии', exact: true }).click();
  await expect(page.locator('.vacancies-screen')).toBeVisible();
  // B446-g4: на 390 карточка — push-экран без блока соответствия (mock-390m-job); там проверяем
  // только процент в строке списка и порядок в листе фильтров.
  if (testInfo.project.name !== 'mobile-390') {
    const card = page.locator('.vacancies-screen-card').filter({
      has: page.getByRole('heading', { name: base.data[0]!.cluster.canonicalTitle, exact: true }),
    });
    if (!(await card.locator('.vacancy-fit-block').isVisible()))
      await card.locator('.vacancies-screen-row-trigger').click();
    // 28.10 mockup: the shown page is queued by the server; the opened vacancy says «считаем»
    // instead of the old «расчёт в очереди / Обновить результат» block and reads again itself.
    const counting = card.getByRole('region', { name: 'Совпадение считается' });
    await expect(counting).toContainText('считаем');
    await expect(card).not.toContainText('Обновить результат');
    await expect(card).not.toContainText('Соответствие: расчёт в очереди');
    completed = true;
    await page.clock.fastForward(16_000);
    const evidence = card.getByRole('region', { name: 'Соответствие вашему профилю' });
    // Mockup 4: the number lives in the row; the card drops its fit block once it is known.
    await expect(evidence).toHaveCount(0);
    // 28.10 mockup: the row's «Совпадение» column holds the coloured number, the company line none.
    await expect(
      card.locator('.vacancies-screen-row-trigger .vacancies-screen-cell--fit [role="img"]'),
    ).toHaveAttribute('aria-label', /^Совпадение 50 %/u);
    await expect(card.locator('.vac-sub')).not.toContainText('соответствие');
    await expect(card).not.toContainText('fixture-fact-01');
    // The opened vacancy only reads; queueing is the server's job for the shown page.
    expect(methods).not.toContain('POST');
  }
  const directory = join('docs/v1-release/tasks/evidence/B525', testInfo.project.name);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, 'fit-evidence.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  // Owner 29.10: no line above the list; at 1440 «Деньги» and «Совпадение» headers sort the
  // whole selection on the server, at 390 there is no sort control at all.
  await expect(page.locator('.vacancy-fit-bar')).toHaveCount(0);
  await expect(page.getByText('Порядок', { exact: true })).toHaveCount(0);
  if (testInfo.project.name === 'mobile-390') {
    await expect(page.locator('.vacancies-sort-header').filter({ visible: true })).toHaveCount(0);
    return;
  }
  const fitHeader = page.getByRole('columnheader', { name: 'Совпадение' });
  await expect(fitHeader).toHaveAttribute('aria-sort', 'descending');
  await page.getByRole('button', { name: 'Деньги' }).click();
  await expect.poll(() => sorts.includes('money')).toBe(true);
  await expect(page.getByRole('columnheader', { name: 'Деньги' })).toHaveAttribute(
    'aria-sort',
    'descending',
  );
});

test('B522 admin audit shows actual spending controls and refreshes read-only', async ({
  page,
}, testInfo) => {
  let reads = 0;
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me'))
      return route.fulfill({
        json: {
          data: {
            username: 'fit-admin',
            email: 'admin@example.test',
            displayName: 'Администратор',
            role: 'admin',
            isTest: true,
            candidateId: null,
          },
        },
      });
    if (path === '/api/admin/llm-spend') {
      reads++;
      expect(route.request().method()).toBe('GET');
      return route.fulfill({
        json: {
          data: {
            enabled: true,
            spentUsd: 0.2,
            heldUsd: 0.1,
            remainingUsd: 0.7,
            dayRemainingUsd: 0.4,
            limits: { runUsd: 0.5, dayUsd: 1, monthUsd: 1, perRequestUsd: 0.1 },
            events: [{ kind: 'budget_exceeded', created_at: '2026-10-18T12:00:00Z' }],
          },
        },
      });
    }
    if (path.endsWith('/admin/users'))
      return route.fulfill({ json: { data: { total: 0, users: [] } } });
    if (path.endsWith('/admin/audit'))
      return route.fulfill({ json: { data: { total: 0, records: [] } } });
    return route.fulfill({ json: { data: null } });
  });
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Журнал/ }).click();
  const spend = page.getByRole('region', { name: 'Расходы массовых расчётов' });
  await expect(spend.getByText('Остаток на месяц')).toBeVisible();
  await expect(spend.getByText(/Достигнут лимит расходов/)).toBeVisible();
  await spend.getByRole('button', { name: 'Обновить расходы' }).click();
  await expect.poll(() => reads).toBe(2);
  await expect(spend).toHaveAttribute('aria-busy', 'false');
  const dir = join('docs/v1-release/tasks/evidence/B525', testInfo.project.name);
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: join(dir, 'admin-spend.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('29.10: a caption without a percent wraps inside the 96px column, never onto the star', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-390', 'the 96px column exists only on desktop');
  await mockSignedInCabinet(page, { vacancyTotal: 2 });
  const base = matchedVacancyPage(0, 2);
  await page.route('**/api/v1/candidate/matched-vacancies*', (route) => {
    const ready = readyVacancyFit(base.data[0]!.cluster.id);
    const blocked = {
      ...ready,
      result: { ...ready.result!, reason: 'blocked_gate', coveragePercent: null },
    };
    return route.fulfill({
      json: {
        ...base,
        data: base.data.map((item) => ({
          ...item,
          explanation: { ...item.explanation, fitView: blocked },
        })),
      },
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Вакансии', exact: true }).click();
  const cell = page.locator('.vacancies-screen-row-trigger .vacancies-screen-cell--fit').first();
  // Owner 29.10: a row without a percent says only «мало требований» or «нет профиля».
  await expect(cell.locator('.vacancy-fit-cap')).toHaveText('мало требований');
  const box = (await cell.boundingBox())!;
  const cap = (await cell.locator('.vacancy-fit-cap').boundingBox())!;
  expect(cap.x + cap.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
});
