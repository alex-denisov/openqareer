import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { SeoGoalSummary } from '../shared/seoSummary';

const summary: SeoGoalSummary = {
  observedAt: '2026-10-24T03:00:00.000Z',
  period: { from: '2026-09-26T03:00:00.000Z', to: '2026-10-24T03:00:00.000Z', days: 28 },
  source: 'internal_operational_records',
  goals: { onboardingCompleted: 12, proTrialsStarted: null, applicationsWithCandidateReceipt: 3 },
  methodology: {
    onboarding: 'explicit_wizard_completion_since_instrumentation',
    trials: 'committed_trial_rows',
    applications: 'candidate_provided_positive_receipt_since_instrumentation',
    deletedCandidates: 'excluded',
    syntheticCandidates: 'excluded',
    organicConversion: 'unavailable_no_attribution',
  },
  searchProviders: {
    google: { status: 'unavailable', stale: false, latestAttempt: null, lastSuccess: null },
    yandex: { status: 'unavailable', stale: false, latestAttempt: null, lastSuccess: null },
  },
};

// Fictional aggregate fixture; these checks prove built UI behavior, not production analytics.
test('administrator can read server goals, select a real period, retry failures and distinguish unavailable metrics', async ({
  page,
}, testInfo) => {
  const requests: number[] = [];
  let fail = false;
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({
      json: {
        data: {
          username: 'admin.test',
          email: null,
          displayName: 'Администратор',
          role: 'admin',
          isTest: true,
          candidateId: null,
        },
      },
    }),
  );
  await page.route('**/api/v1/admin/seo-summary?*', (route) => {
    const days = Number(new URL(route.request().url()).searchParams.get('days'));
    requests.push(days);
    return fail
      ? route.fulfill({
          status: 403,
          json: { error: { code: 'forbidden', message: 'Недостаточно прав.' } },
        })
      : route.fulfill({ json: { data: { ...summary, period: { ...summary.period, days } } } });
  });
  await page.goto('/admin?tab=seo', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'SEO-сводка', exact: true })).toBeVisible();
  await expect(page.getByText('12 — завершили мастер настройки')).toBeVisible();
  await expect(page.getByText('Недоступно — запустили пробную подписку Pro')).toBeVisible();
  await expect(
    page.getByText('Google Search Console: данные API недоступны.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Конверсия из органического поиска недоступна:', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '28 дней', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: '7 дней', exact: true }).click();
  await expect(page.getByRole('button', { name: '7 дней', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText('12 — завершили мастер настройки')).toBeVisible();
  expect(requests).toEqual([28, 7]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  mkdirSync('output/b352-goals', { recursive: true });
  await page.screenshot({
    path: `output/b352-goals/seo-${testInfo.project.name}.png`,
    fullPage: true,
  });
  const axe = await new AxeBuilder({ page }).include('.admin-workspace').analyze();
  writeFileSync(
    `output/b352-goals/axe-${testInfo.project.name}.json`,
    JSON.stringify({ violations: axe.violations, passes: axe.passes.length }, null, 2),
  );
  expect(axe.violations).toEqual([]);
  const artifactHtml = await page.evaluate(() => {
    const css = Array.from(document.styleSheets)
      .map((sheet) =>
        Array.from(sheet.cssRules)
          .map((rule) => rule.cssText)
          .join('\n'),
      )
      .join('\n');
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${document.querySelector('.admin-console')?.outerHTML}</body></html>`;
  });
  writeFileSync(`output/b352-goals/seo-${testInfo.project.name}.html`, artifactHtml);
  fail = true;
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось получить сводку');
  await expect(page.getByText('12 — завершили мастер настройки')).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByText('12 — завершили мастер настройки')).toBeVisible();
  await page.getByRole('button', { name: '90 дней', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '90 дней', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText('12 — завершили мастер настройки')).toBeVisible();
  expect(requests.at(-1)).toBe(90);
});

test('prepared official source displays real zero, missing position and preserved stale data after failed refresh', async ({
  page,
}, testInfo) => {
  const source = {
    status: 'available',
    stale: true,
    latestAttempt: {
      observedAt: '2026-10-24T03:00:00.000Z',
      mode: 'official_api',
      status: 'unavailable',
      reason: 'network_error',
    },
    lastSuccess: {
      observedAt: '2026-10-01T03:00:00.000Z',
      mode: 'official_api',
      window: { from: '2026-09-01', to: '2026-09-28', timezone: 'America/Los_Angeles' },
      metrics: { clicks: 0, impressions: 4, ctr: 0, position: null, indexedPages: null, sqi: null },
      queries: Array.from({ length: 50 }, (_, index) => ({
        query: index === 0 ? 'q'.repeat(160) : `Синтетический запрос${index}`,
        clicks: 0,
        impressions: 4,
        ctr: 0,
        position: null,
      })),
      sections: { aggregate: 'available', queries: 'available' },
    },
  };
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({
      json: {
        data: {
          username: 'admin.test',
          email: null,
          displayName: 'Администратор',
          role: 'admin',
          isTest: true,
          candidateId: null,
        },
      },
    }),
  );
  await page.route('**/api/v1/admin/seo-summary?*', (route) =>
    route.fulfill({
      json: {
        data: {
          ...summary,
          searchProviders: { ...summary.searchProviders, google: source },
        },
      },
    }),
  );
  await page.goto('/admin?tab=seo', { waitUntil: 'domcontentloaded' });
  const region = page.getByRole('region', { name: 'Google Search Console', exact: true });
  await expect(region).toContainText('Клики: 0. Показы: 4. CTR: 0%. Средняя позиция: нет данных.');
  await expect(region).toContainText('Срез устарел');
  await expect(region).toContainText('Показано предыдущее успешное наблюдение');
  await page.screenshot({
    path: `output/b352-goals/seo-prepared-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await region.getByText('Популярные запросы (50)', { exact: true }).click();
  await expect(region.getByRole('listitem')).toHaveCount(50);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const axe = await new AxeBuilder({ page }).include('.admin-workspace').analyze();
  expect(axe.violations).toEqual([]);
  writeFileSync(
    `output/b352-goals/axe-prepared-${testInfo.project.name}.json`,
    JSON.stringify({ violations: axe.violations, passes: axe.passes.length }, null, 2),
  );
  await region.getByRole('listitem').first().scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `output/b352-goals/seo-prepared-queries-${testInfo.project.name}.png`,
  });
  const artifactHtml = await page.evaluate(() => {
    const css = Array.from(document.styleSheets)
      .map((sheet) =>
        Array.from(sheet.cssRules)
          .map((rule) => rule.cssText)
          .join('\n'),
      )
      .join('\n');
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${document.querySelector('.admin-console')?.outerHTML}</body></html>`;
  });
  writeFileSync(`output/b352-goals/seo-prepared-${testInfo.project.name}.html`, artifactHtml);
});
