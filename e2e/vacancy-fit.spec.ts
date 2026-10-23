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
  let queued = false;
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
                ? { state: 'not_requested', requirements: [] }
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
      queued = true;
      return route.fulfill({
        status: 202,
        json: { data: { state: 'processing', requirements: [] } },
      });
    }
    return route.fulfill({
      json: {
        data: completed
          ? readyVacancyFit(vacancyId)
          : { state: queued ? 'processing' : 'not_requested', requirements: [] },
      },
    });
  });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Вакансии', exact: true }).click();
  await expect(page.locator('.vacancies-screen')).toBeVisible();
  // B446-g4: на 390 карточка — push-экран без блока соответствия (mock-390m-job); там проверяем
  // только процент в строке списка и порядок в листе фильтров.
  if (testInfo.project.name !== 'mobile-390') {
    const card = page.locator('.vacancies-screen-card').filter({
      has: page.getByRole('heading', { name: base.data[0]!.cluster.canonicalTitle, exact: true }),
    });
    if (!(await card.locator('.vacancy-fit-evidence').isVisible()))
      await card.locator('.vacancies-screen-row-trigger').click();
    const evidence = card.getByRole('region', { name: 'Соответствие вашему профилю' });
    await evidence.getByRole('button', { name: 'Рассчитать соответствие', exact: true }).click();
    await expect(evidence.getByRole('status')).toContainText('Расчёт в очереди');
    await expect(evidence.locator('.vacancy-fit-percent')).toHaveCount(0);
    completed = true;
    await evidence.getByRole('button', { name: 'Обновить результат' }).click();
    await expect(evidence.locator('.vacancy-fit-percent')).toHaveText('50%');
    // B525: строка списка — «соответствие 50 %» в той же строке «компания · источник» (V3).
    await expect(card.locator('.vacancies-screen-row-trigger .vacancy-fit-inline')).toHaveText(
      'соответствие 50\u00a0%',
    );
    // B446-g4: в карточке 1440 соответствие одной строкой (макет 4), таблицы разбора нет.
    await expect(evidence).toContainText('2 из 4 требований');
    await expect(evidence).not.toContainText('fixture-fact-01');
    // G5 item 9: the POST answer is the queued view, only «Обновить результат» reads again.
    expect(methods).toEqual(['POST', 'GET']);
  }
  const directory = join('docs/v1-release/tasks/evidence/B525', testInfo.project.name);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, 'fit-evidence.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  // B446-g4: на 1440 порядок — в строке заголовков колонок, на 390 — строка в листе фильтров.
  if (testInfo.project.name === 'mobile-390')
    await page.getByRole('button', { name: 'Фильтры', exact: true }).click();
  const sortScope =
    testInfo.project.name === 'mobile-390'
      ? page.locator('.vacancies-mobile-sheet')
      : page.locator('.vacancies-table-header');
  await sortScope.getByLabel('Порядок вакансий').selectOption('freshness');
  if (testInfo.project.name === 'mobile-390')
    await page.locator('.vacancies-mobile-sheet-cta').click();
  await expect.poll(() => sorts.includes('freshness')).toBe(true);
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
            limits: { runUsd: 0.5, dayUsd: 1, totalUsd: 1, perRequestUsd: 0.1 },
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
  await expect(spend.getByText('Общий остаток')).toBeVisible();
  await expect(spend.getByText(/Достигнут лимит расходов/)).toBeVisible();
  await spend.getByRole('button', { name: 'Обновить расходы' }).click();
  await expect.poll(() => reads).toBe(2);
  await expect(spend).toHaveAttribute('aria-busy', 'false');
  const dir = join('docs/v1-release/tasks/evidence/B525', testInfo.project.name);
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: join(dir, 'admin-spend.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
