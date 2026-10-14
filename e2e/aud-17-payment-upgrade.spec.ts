import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { e2eEvidenceDirectory } from './fixtures/evidencePath';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

const EVIDENCE_DIR = e2eEvidenceDirectory('AUD-17');

test.beforeAll(() => mkdirSync(EVIDENCE_DIR, { recursive: true }));

test('AUD-17: Executive consent is stored and readable after reload', async ({
  page,
}, testInfo) => {
  const viewport = testInfo.project.name === 'mobile-390' ? '390' : '1440';
  const isMobile = viewport === '390';
  await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await prepareCabinet(page);
  const unmatched = await mockSignedInCabinet(page, {
    billing: { initialPlan: 'free', executiveStatus: 'waitlisted' },
  });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await openTariffs(page);
  await openExecutiveOffer(page, isMobile);

  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('textbox', { name: 'Расскажите о задаче' })
    .fill('Найти CTO для финтех-компании');
  await dialog.getByRole('textbox', { name: 'Цель и сроки' }).fill('До конца года');
  await dialog.getByRole('checkbox', { name: /Разрешаю команде видеть/u }).check();
  await dialog.getByRole('button', { name: 'Отправить заявку' }).click();
  await expect(dialog.getByTestId('executive-request-result')).toContainText(
    'Вы в списке ожидания',
  );
  await expect(dialog).not.toContainText('в течение недели на почту');
  await capture(page, 'executive-waitlisted', viewport);

  await page.reload({ waitUntil: 'domcontentloaded' });
  const requests = await page.evaluate(async () => {
    const response = await fetch('/api/v1/candidate/executive-requests', {
      credentials: 'include',
    });
    return (await response.json()) as {
      data: {
        items: Array<{ profileSharingConsent: boolean; profileSharingConsentAt: string | null }>;
      };
    };
  });
  expect(requests.data.items[0]).toMatchObject({ profileSharingConsent: true });
  expect(requests.data.items[0]?.profileSharingConsentAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  expect(unmatched).toEqual([]);
});

test('AUD-17: past-due payment recovery creates a recurring checkout', async ({
  page,
}, testInfo) => {
  const viewport = testInfo.project.name === 'mobile-390' ? '390' : '1440';
  const isMobile = viewport === '390';
  await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await prepareCabinet(page);
  const unmatched = await mockSignedInCabinet(page, {
    billing: {
      initialPlan: 'basic',
      subscriptionStatus: 'past_due',
      checkoutStatuses: ['processing'],
    },
  });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await openTariffs(page);

  const tariffs = page.locator(
    isMobile ? '.career-tariffs-mobile:visible' : '.career-tariffs-desktop:visible',
  );
  const updateMethod = tariffs.getByRole('button', { name: 'Обновить способ оплаты', exact: true });
  await expect(updateMethod).toBeVisible();
  const targetSize = await updateMethod.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  expect(targetSize.width).toBeGreaterThanOrEqual(44);
  expect(targetSize.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press('Tab');
  await updateMethod.focus();
  await expect(updateMethod).toBeFocused();
  expect(await updateMethod.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
  await capture(page, 'past-due', viewport);
  await updateMethod.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveAccessibleName('Обновить способ оплаты');
  await expect(dialog.getByTestId('tariff-checkout')).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: /автопродление/u })).toBeChecked();
  await capture(page, 'payment-method-checkout', viewport);
  await dialog.getByRole('button', { name: /Перейти к оплате/u }).click();
  await expect(dialog.getByTestId('tariff-payment-pending')).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Открыть страницу Robokassa' })).toHaveAttribute(
    'href',
    /^https:\/\/auth\.robokassa\.ru\//u,
  );
  await dialog.getByRole('button', { name: 'Проверить статус' }).click();
  await expect(dialog).toContainText('Платёж принят, ждём подтверждения банка');
  await capture(page, 'payment-method-processing', viewport);
  await page.setViewportSize({ width: 280, height: 844 });
  await expectNoHorizontalOverflow(page);
  expect(unmatched).toEqual([]);
});

async function prepareCabinet(page: Page): Promise<void> {
  await page.route('**/health', (route) => route.fulfill({ status: 200, body: 'fixture' }));
}

async function openTariffs(page: Page): Promise<void> {
  const trigger = page
    .locator('.career-rail-wallet:visible, .career-mobile-tariffs:visible')
    .first();
  await expect(trigger).toBeVisible({ timeout: 20_000 });
  await trigger.click();
  await expect(page.locator('.career-tariffs:visible')).toBeVisible();
}

async function openExecutiveOffer(page: Page, isMobile: boolean): Promise<void> {
  if (isMobile) {
    const mobile = page.locator('.career-tariffs-mobile:visible');
    await mobile.getByRole('button', { name: /^Executive\b/u }).click();
    await mobile.getByRole('button', { name: 'Оставить заявку' }).click();
    return;
  }
  const executive = page.locator('#lvl-exec');
  if (
    !(await executive
      .locator('summary')
      .evaluate((node) => node.parentElement?.hasAttribute('open')))
  ) {
    await executive.locator('summary').click();
  }
  await executive.getByRole('button', { name: 'Оставить заявку' }).click();
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
