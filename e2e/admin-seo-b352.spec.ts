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
  searchProviders: { google: { status: 'unavailable' }, yandex: { status: 'unavailable' } },
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
