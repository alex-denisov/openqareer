import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { e2eEvidenceDirectory } from './fixtures/evidencePath';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { openTariffsFromShell } from './helpers/open-tariffs';

const EVIDENCE_DIR = e2eEvidenceDirectory('AUD-7');

test.beforeAll(() => mkdirSync(EVIDENCE_DIR, { recursive: true }));

test('AUD-07: return to Free disables renewal and persists after reload', async ({
  page,
}, testInfo) => {
  const viewport = testInfo.project.name === 'mobile-390' ? '390' : '1440';
  const isMobile = viewport === '390';
  await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await prepareCabinet(page);
  const unmatched = await mockSignedInCabinet(page, { billing: { initialPlan: 'pro' } });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await openTariffs(page);

  if (isMobile) await page.getByRole('button', { name: /^Free\b/u }).click();
  const returnToFree = page.getByRole('button', { name: 'Вернуться на Free', exact: true });
  await expect(returnToFree).toBeVisible();
  const target = await returnToFree.evaluate((element) => {
    const { width, height } = element.getBoundingClientRect();
    return { width, height };
  });
  expect(target.width).toBeGreaterThanOrEqual(44);
  expect(target.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press('Tab');
  await returnToFree.focus();
  expect(await returnToFree.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
  await capture(page, 'free-return', viewport);
  await returnToFree.click();
  if (isMobile) await page.getByRole('button', { name: 'Назад к списку тарифов' }).click();
  await expect(page.locator('.career-billing-success:visible')).toContainText(
    'Автопродление отключено',
  );
  await capture(page, 'free-return-confirmed', viewport);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await openTariffs(page);
  const billing = await page.evaluate(async () => {
    const response = await fetch('/api/v1/candidate/billing', { credentials: 'include' });
    return (await response.json()) as {
      data: {
        currentPlan: string;
        subscription: { autoRenew: boolean; nextChargeAt: string | null };
      };
    };
  });
  expect(billing.data.currentPlan).toBe('pro');
  expect(billing.data.subscription).toMatchObject({ autoRenew: false, nextChargeAt: null });
  await page.setViewportSize({ width: 280, height: 844 });
  await expectNoHorizontalOverflow(page);
  expect(unmatched).toEqual([]);
});

test('AUD-07: paid downgrade stops at the provider boundary without changing the plan', async ({
  page,
}, testInfo) => {
  const viewport = testInfo.project.name === 'mobile-390' ? '390' : '1440';
  const isMobile = viewport === '390';
  await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await prepareCabinet(page);
  const unmatched = await mockSignedInCabinet(page, { billing: { initialPlan: 'pro' } });
  let checkoutRequests = 0;
  page.on('request', (request) => {
    if (
      request.url().includes('/api/v1/candidate/billing/checkouts') &&
      request.method() === 'POST'
    ) {
      checkoutRequests += 1;
    }
  });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await openTariffs(page);

  if (isMobile) await page.getByRole('button', { name: /^Basic\b/u }).click();
  await page.getByRole('button', { name: 'Понизить до Basic', exact: true }).click();
  const unavailable = page.getByTestId('tariff-plan-change-unavailable');
  await expect(unavailable).toContainText('Текущий тариф не изменён');
  await expect(unavailable).not.toContainText('пока недоступн');
  expect(checkoutRequests).toBe(0);
  await capture(page, 'paid-downgrade-unavailable', viewport);
  await page.setViewportSize({ width: 280, height: 844 });
  await expectNoHorizontalOverflow(page);
  expect(unmatched).toEqual([]);
});

test('AUD-07: disabled renewal reports the manual-payment boundary and stays disabled', async ({
  page,
}, testInfo) => {
  const viewport = testInfo.project.name === 'mobile-390' ? '390' : '1440';
  await page.setViewportSize(
    viewport === '390' ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  );
  await prepareCabinet(page);
  const unmatched = await mockSignedInCabinet(page, {
    billing: { initialPlan: 'pro', autoRenew: false },
  });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await openTariffs(page);

  const enableRenewal = page.getByRole('button', { name: 'Включить автопродление', exact: true });
  await expect(enableRenewal).toBeVisible();
  await capture(page, 'renewal-unavailable', viewport);
  await enableRenewal.click();
  await expect(page.getByText(/пока недоступн/u)).toHaveCount(0);
  await expect(page.locator('.career-billing-error[role="status"]:visible')).toContainText(
    'Оплатите следующий период вручную',
  );
  await capture(page, 'renewal-prepared', viewport);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await openTariffs(page);
  const billing = await page.evaluate(async () => {
    const response = await fetch('/api/v1/candidate/billing', { credentials: 'include' });
    return (await response.json()) as { data: { subscription: { autoRenew: boolean } } };
  });
  expect(billing.data.subscription.autoRenew).toBe(false);
  expect(unmatched).toEqual([]);
});

test('AUD-07: comparison opens on desktop and mobile', async ({ page }, testInfo) => {
  const viewport = testInfo.project.name === 'mobile-390' ? '390' : '1440';
  const isMobile = viewport === '390';
  await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await prepareCabinet(page);
  const unmatched = await mockSignedInCabinet(page, { billing: { initialPlan: 'free' } });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await openTariffs(page);

  if (isMobile) {
    await page.getByRole('button', { name: 'Сравнить по шагам пути', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Сравнение' })).toBeVisible();
  } else {
    await page.getByRole('button', { name: 'Сравнить тарифы', exact: true }).click();
    await expect(
      page.getByRole('table', { name: 'Сравнение тарифов по шагам пути' }),
    ).toBeVisible();
  }
  await capture(page, 'comparison', viewport);
  await page.setViewportSize({ width: 280, height: 844 });
  await expectNoHorizontalOverflow(page);
  expect(unmatched).toEqual([]);
});

test('AUD-07: every paid level opens its matching offer without starting payment', async ({
  page,
}, testInfo) => {
  const viewport = testInfo.project.name === 'mobile-390' ? '390' : '1440';
  const isMobile = viewport === '390';
  await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await prepareCabinet(page);
  const unmatched = await mockSignedInCabinet(page, { billing: { initialPlan: 'free' } });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await openTariffs(page);

  for (const plan of ['Basic', 'Pro', 'Max']) {
    if (isMobile) {
      await page
        .locator('.career-tariffs-mobile:visible')
        .getByRole('button', { name: new RegExp('^' + plan + '\\b', 'u') })
        .click();
    }
    await page.getByRole('button', { name: 'Перейти на ' + plan, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveAccessibleName('Переход на тариф ' + plan);
    await expect(dialog.getByTestId('tariff-offer')).toBeVisible();
    await capture(page, 'offer-' + plan.toLowerCase(), viewport);
    await dialog.getByRole('button', { name: 'Закрыть оплату' }).click();
    if (isMobile) await page.getByRole('button', { name: 'Назад к списку тарифов' }).click();
  }
  expect(unmatched).toEqual([]);
});

async function prepareCabinet(page: Page): Promise<void> {
  await page.route('**/health', (route) => route.fulfill({ status: 200, body: 'fixture' }));
}

async function openTariffs(page: import('@playwright/test').Page): Promise<void> {
  await openTariffsFromShell(page);
}

async function capture(page: Page, state: string, viewport: string): Promise<void> {
  await page.screenshot({ path: join(EVIDENCE_DIR, `${state}-${viewport}.png`), fullPage: true });
  const styles = await page.evaluate(async () => {
    const sheets = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')];
    return (
      await Promise.all(
        sheets.map(async (sheet) => {
          try {
            const response = await fetch(sheet.href);
            return response.ok ? response.text() : '';
          } catch {
            return '';
          }
        }),
      )
    ).join('\n');
  });
  const html = await page.evaluate((css) => {
    const snapshot = document.documentElement.cloneNode(true) as HTMLHtmlElement;
    snapshot
      .querySelectorAll('script, link[rel="stylesheet"]')
      .forEach((element) => element.remove());
    const style = document.createElement('style');
    style.textContent = css;
    snapshot.querySelector('head')?.append(style);
    return `<!doctype html>${snapshot.outerHTML}`;
  }, styles);
  writeFileSync(join(EVIDENCE_DIR, `${state}-${viewport}.html`), html, 'utf8');
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}
