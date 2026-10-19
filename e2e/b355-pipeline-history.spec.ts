import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  application,
  openB486Responses,
  seedB486Workspace,
  stubB486Session,
} from './helpers/b486-responses-fixture';

test('B355 exposes a complete archived-history funnel through a real accessible toggle', async ({
  page,
}, testInfo) => {
  const applications = [
    application({ id: 'applied', stage: 'applied', reachedStages: ['applied'] }),
    ...Array.from({ length: 99 }, (_, i) =>
      application({
        id: `saved-archive-${i}`,
        stage: 'archived',
        archivePreviousStage: 'saved',
        reachedStages: ['saved', 'archived'],
      }),
    ),
    application({
      id: 'historical-offer',
      stage: 'archived',
      archivePreviousStage: 'offer',
      reachedStages: ['applied', 'offer', 'archived'],
    }),
    application({ id: 'direct-offer', stage: 'offer', reachedStages: ['offer'] }),
  ];
  await stubB486Session(page, { applications });
  const calls: URL[] = [];
  await page.route('**/api/v1/candidate/applications?*', async (route) => {
    const url = new URL(route.request().url());
    calls.push(url);
    const stages = url.searchParams.getAll('stage');
    const filtered = applications.filter(
      (entry) => !stages.length || stages.includes(String(entry.stage)),
    );
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? 20);
    await route.fulfill({
      json: {
        data: filtered.slice(offset, offset + limit),
        meta: {
          total: filtered.length,
          offset,
          limit,
          stageCounts: {
            saved: 0,
            applied: 1,
            responded: 0,
            interview: 0,
            offer: 1,
            rejected: 0,
            archived: 100,
          },
        },
      },
    });
  });
  await seedB486Workspace(page);
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await openB486Responses(page);
  const toggle = page.getByRole('button', { name: 'Аналитика этапов', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  calls.length = 0;
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const panel = page.getByRole('region', { name: 'История этапов откликов' });
  await expect(panel.getByText('Карточек в выборке:', { exact: false })).toContainText('102');
  await expect(
    panel.locator('.career-pipeline-kpi-card').filter({ hasText: 'Сквозная конверсия' }),
  ).toContainText('50%');
  await expect(
    panel
      .locator('.career-pipeline-funnel-row')
      .filter({ hasText: 'Откликнулись' })
      .locator('.career-pipeline-funnel-count'),
  ).toHaveText('2');
  await expect(
    panel.locator('.career-pipeline-funnel-row').filter({ hasText: 'Получен оффер' }),
  ).toContainText('2');
  expect(
    calls.some((url) => url.searchParams.get('offset') === '100' && !url.searchParams.has('stage')),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
  await mkdir('test-results/evidence/B355', { recursive: true });
  await panel.screenshot({
    path: `test-results/evidence/B355/analytics-${testInfo.project.name}.png`,
  });
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(panel.getByRole('heading', { name: 'Аналитика воронки', exact: true })).toBeHidden();
});
