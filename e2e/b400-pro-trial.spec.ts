import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { openTariffsFromShell } from './helpers/open-tariffs';

test('B400: activate once, retain server-confirmed state on reload, and show expiry without payment', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const unmatched = await mockSignedInCabinet(page, { billing: { initialPlan: 'free' } });
  let status: 'eligible' | 'active' | 'expired' = 'eligible';
  let activations = 0;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.parse(now) + 86_400_000).toISOString();
  await page.route('**/api/v1/candidate/billing/trial', async (route) => {
    if (route.request().method() === 'POST') {
      activations += 1;
      status = 'active';
    }
    await route.fulfill({
      status: route.request().method() === 'POST' ? 201 : 200,
      json: {
        data: {
          status,
          startedAt: status === 'eligible' ? null : now,
          expiresAt: status === 'eligible' ? null : expiresAt,
          serverNow: now,
        },
      },
    });
  });
  await page.route('**/api/v1/candidate/billing', async (route) =>
    route.fulfill({
      json: {
        data: {
          currentPlan: status === 'active' ? 'pro' : 'free',
          subscription: null,
          plans: [
            { id: 'pro', name: 'Pro', amountKopecks: 990000, currency: 'RUB', interval: 'month' },
          ],
        },
      },
    }),
  );
  let checkoutRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/billing/checkouts') && request.method() === 'POST')
      checkoutRequests += 1;
  });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await openTariffsFromShell(page);
  const panel = page.getByRole('region', { name: 'Пробный Pro', exact: true });
  await expect(
    panel.getByRole('button', { name: 'Включить Pro на 24 часа бесплатно' }),
  ).toBeVisible();
  if (info.project.name === 'mobile-390') {
    const mobile = page.locator('.career-tariffs-mobile:visible');
    await mobile.getByRole('button', { name: /^Pro\b/u }).click();
    await mobile.getByRole('button', { name: /Перейти на Pro/u }).click();
  } else {
    const card = page.locator('#lvl-pro');
    await card.locator('summary').click();
    await card.getByRole('button', { name: /Перейти на Pro/u }).click();
  }
  const dialog = page.getByTestId('career-paywall-modal');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Включить Pro на 24 часа бесплатно' }).click();
  await expect(dialog.getByText('Pro уже подключён.', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'К тарифам', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'Пробный Pro включён' })).toBeVisible();
  expect(activations).toBe(1);
  expect(checkoutRequests).toBe(0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openTariffsFromShell(page);
  await expect(panel.getByRole('heading', { name: 'Пробный Pro включён' })).toBeVisible();
  await expect(panel.getByRole('button')).toHaveCount(0);
  mkdirSync('output/B400', { recursive: true });
  await page.screenshot({
    path: `output/B400/trial-active-${info.project.name}.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.addScriptTag({ path: createRequire(import.meta.url).resolve('axe-core/axe.min.js') });
  const violations = await page.evaluate(async () => {
    const result = await (
      window as unknown as {
        axe: { run: (selector: string) => Promise<{ violations: unknown[] }> };
      }
    ).axe.run('[aria-label="Пробный Pro"]');
    return result.violations;
  });
  writeFileSync(`output/B400/axe-${info.project.name}.json`, JSON.stringify(violations, null, 2));
  expect(violations).toEqual([]);
  const html = await page.evaluate(() => {
    const styles = [...document.styleSheets]
      .map((sheet) => {
        try {
          return [...sheet.cssRules].map((rule) => rule.cssText).join('\n');
        } catch {
          return '';
        }
      })
      .join('\n');
    const body = document.body.cloneNode(true) as HTMLElement;
    body.querySelectorAll('script').forEach((script) => script.remove());
    return (
      '<!doctype html><html lang="ru"><head><meta charset="UTF-8"><style>' +
      styles +
      '</style></head><body>' +
      body.innerHTML +
      '</body></html>'
    );
  });
  writeFileSync(`output/B400/harness-${info.project.name}.html`, html);
  status = 'expired';
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openTariffsFromShell(page);
  await expect(panel.getByRole('heading', { name: 'Пробный Pro завершён' })).toBeVisible();
  await expect(panel.getByRole('button')).toHaveCount(0);
  expect(activations).toBe(1);
  expect(unmatched).toEqual([]);
});
