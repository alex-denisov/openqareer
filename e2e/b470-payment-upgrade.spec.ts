import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { e2eEvidenceDirectory } from './fixtures/evidencePath';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { captureCareerHarness } from './helpers/capture-career-harness';

const EVIDENCE_DIR = e2eEvidenceDirectory('B470');
const S10_EVIDENCE_DIR = e2eEvidenceDirectory('S10-VIS');

test.beforeAll(() => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  mkdirSync(S10_EVIDENCE_DIR, { recursive: true });
});

test('S10-VIS: actual tariff page keeps every listed price and locates current-plan billing and history', async ({
  page,
}, testInfo) => {
  const isMobile = testInfo.project.name === 'mobile-390';
  await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.route('**/health', (route) => route.fulfill({ status: 200, body: 'fixture' }));
  const unmatched = await mockSignedInCabinet(page, { billing: { initialPlan: 'basic' } });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await openTariffs(page);

  const tariffView = page.locator(
    isMobile ? '.career-tariffs-mobile:visible' : '.career-tariffs-desktop:visible',
  );
  await expect(tariffView).toBeVisible();
  if (isMobile) {
    await expect(tariffView.locator('.career-mob-row')).toHaveCount(5);
    await expect(tariffView).toContainText('Basic');
    await expect(tariffView).toContainText('3 990 ₽');
    await expect(tariffView).toContainText('Ваш тариф');
    await captureS10Tariffs(page, 'tariffs-390');
  } else {
    const prices = [
      ['#lvl-free', '0 ₽'],
      ['#lvl-go', '3 990 ₽'],
      ['#lvl-pro', '9 900 ₽'],
      ['#lvl-max', '39 900 ₽'],
      ['#lvl-exec', '150–300 тыс. ₽'],
    ] as const;
    for (const [selector, price] of prices) {
      await expect(tariffView.locator(selector)).toContainText(price);
    }
    const currentTier = tariffView.locator('#lvl-go');
    await expect(currentTier).toContainText('Basic');
    await expect(currentTier).toContainText('Ваш тариф');
    expect(
      await currentTier
        .locator('summary')
        .evaluate((summary) => summary.parentElement?.hasAttribute('open') ?? false),
    ).toBe(true);
    await expect(
      currentTier.getByRole('heading', { name: 'Что входит', exact: true }),
    ).toBeVisible();
    await expect(
      currentTier.getByRole('heading', { name: 'Чего нет на этом тарифе', exact: true }),
    ).toBeVisible();
    await captureS10Tariffs(page, 'tariffs-1440');

    const billingInsideTier = await currentTier
      .getByText('Следующее списание', { exact: true })
      .count();
    const historyInsideTier = await currentTier
      .getByText('История платежей', { exact: true })
      .count();
    if (billingInsideTier && historyInsideTier) {
      await expect(currentTier.getByText('Следующее списание', { exact: true })).toBeVisible();
      await expect(currentTier.getByText('История платежей', { exact: true })).toBeVisible();
    } else {
      await expect(tariffView.getByText('Следующее списание', { exact: true })).toHaveCount(0);
      await expect(tariffView.getByText('История платежей', { exact: true })).toHaveCount(0);
      const accountButton = page
        .locator('.career-account-button:visible, .career-account-trigger:visible')
        .first();
      await expect(accountButton).toBeVisible();
      await accountButton.click();
      const account = page.getByRole('dialog', { name: 'Аккаунт' });
      await expect(account).toBeVisible();
      await account.getByRole('button', { name: 'Подписка и платежи' }).click();
      await expect(account.getByText('Следующее списание', { exact: true })).toBeVisible();
      await expect(account.getByText('История платежей', { exact: true })).toBeVisible();
    }
  }
  expect(unmatched).toEqual([]);
});

test('B470: Basic/Pro checkout follows verified invoice status on desktop and mobile', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const viewport = testInfo.project.name === 'mobile-390' ? '390' : '1440';
  const isMobile = viewport === '390';
  await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.route('**/health', (route) => route.fulfill({ status: 200, body: 'fixture' }));
  await mockSignedInCabinet(page, {
    billing: { initialPlan: 'free', checkoutStatuses: ['processing', 'paid', 'failed'] },
  });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await openTariffs(page);
  const tariffView = page.locator(
    isMobile ? '.career-tariffs-mobile:visible' : '.career-tariffs-desktop:visible',
  );
  if (isMobile) {
    await expect(tariffView.getByText(/Оплаченных платежей пока нет/u)).toBeVisible();
  } else {
    await expect(tariffView.getByText(/Оплаченных платежей пока нет/u)).toHaveCount(0);
  }
  await capture(page, 'billing-empty', viewport);
  for (const id of ['#lvl-go', '#lvl-pro', '#lvl-max', '#lvl-exec']) {
    await expect(page.locator(id)).toHaveCount(1);
  }
  await scrollTariffsToBottom(page);
  await capture(page, 'tariffs-many', viewport);
  await page
    .locator('#career-main')
    .evaluate((main) => main.scrollTo({ top: 0, behavior: 'instant' }));
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));

  await openTariffLevel(page, 'basic', isMobile);
  const dialog = page.getByTestId('career-paywall-modal');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Basic');
  await expect(dialog).toContainText('3 990');
  await expect(dialog).not.toContainText('письмо за 2 дня');
  await capture(page, 'payment-offer', viewport);

  await dialog.getByRole('button', { name: /Перейти на Basic/u }).click();
  await expect(dialog.getByTestId('tariff-checkout')).toBeVisible();
  await expect(dialog).toContainText('qa-readability@example.com');
  await expect(dialog.getByRole('checkbox', { name: /автопродление/u })).not.toBeChecked();
  await expectConsentLayout(dialog, /автопродление/u, viewport);
  await capture(page, 'payment-checkout', viewport);

  await dialog.getByRole('button', { name: /Перейти к оплате/u }).click();
  await expect(dialog.getByTestId('tariff-payment-pending')).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Открыть страницу Robokassa' })).toHaveAttribute(
    'href',
    /^https:\/\/auth\.robokassa\.ru\//u,
  );
  await capture(page, 'payment-pending', viewport);

  await dialog.getByRole('button', { name: 'Проверить статус' }).click();
  await expect(dialog).toContainText('Платёж принят, ждём подтверждения банка');
  await capture(page, 'payment-processing', viewport);
  await dialog.getByRole('button', { name: 'Проверить статус' }).click();
  await expect(dialog.getByTestId('tariff-payment-success')).toBeVisible();
  await expect(dialog).toContainText('Basic подключён');
  await expect(dialog).toContainText('11 ноября');
  await capture(page, 'payment-paid', viewport);

  await dialog.getByRole('button', { name: 'К тарифам' }).click();
  await expect(page.getByTestId('career-paywall-modal')).toHaveCount(0);
  await openTariffLevel(page, 'pro', isMobile);
  const proDialog = page.getByTestId('career-paywall-modal');
  await expect(proDialog).toContainText('Pro');
  await proDialog.getByRole('button', { name: /Перейти на Pro/u }).click();
  await proDialog.getByRole('button', { name: /Перейти к оплате/u }).click();
  await expect(proDialog.getByTestId('tariff-payment-pending')).toBeVisible();
  await proDialog.getByRole('button', { name: 'Проверить статус' }).click();
  await expect(proDialog.getByTestId('tariff-payment-failed')).toBeVisible();
  await expect(proDialog).toContainText('Тариф не изменён');
  await capture(page, 'payment-failed', viewport);

  await expectNoHorizontalOverflow(page);
});

test('B470: Executive request uses B471 status and does not claim payment or email follow-up', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const viewport = testInfo.project.name === 'mobile-390' ? '390' : '1440';
  const isMobile = viewport === '390';
  await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.route('**/health', (route) => route.fulfill({ status: 200, body: 'fixture' }));
  await mockSignedInCabinet(page, {
    billing: { initialPlan: 'free', executiveStatus: 'waitlisted' },
  });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await openTariffs(page);
  await openTariffLevel(page, 'exec', isMobile);

  const dialog = page.getByTestId('career-paywall-modal');
  await expect(dialog.getByTestId('executive-request-form')).toBeVisible();
  await expectConsentLayout(dialog, /Разрешаю команде видеть/u, viewport);
  await capture(page, 'executive-form', viewport);
  await dialog
    .getByRole('textbox', { name: 'Расскажите о задаче' })
    .fill('Найти CTO для финтех-компании');
  await dialog.getByRole('textbox', { name: 'Цель и сроки' }).fill('До конца года');
  const submit = dialog.getByRole('button', { name: 'Отправить заявку' });
  await expect(submit).toBeDisabled();
  await dialog.getByRole('checkbox', { name: /Разрешаю команде видеть/u }).check();
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(dialog.getByTestId('executive-request-result')).toBeVisible();
  await expect(dialog).toContainText('Вы в списке ожидания');
  await expect(dialog).toContainText('Оплата не списывалась');
  await expect(dialog).not.toContainText('в течение недели на почту');
  await capture(page, 'executive-waitlist', viewport);
  await page.reload({ waitUntil: 'domcontentloaded' });
  const storedRequest = await page.evaluate(async () => {
    const response = await fetch('/api/v1/candidate/executive-requests', {
      credentials: 'include',
    });
    return (await response.json()) as {
      data: { items: Array<{ profileSharingConsent: boolean }> };
    };
  });
  expect(storedRequest.data.items[0]?.profileSharingConsent).toBe(true);
  await expectNoHorizontalOverflow(page);
});

test('B470: checkout exposes a reachable loading state while the API creates an invoice', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const viewport = testInfo.project.name === 'mobile-390' ? '390' : '1440';
  const isMobile = viewport === '390';
  let releaseCheckout: (() => void) | undefined;
  const checkoutWait = new Promise<void>((resolve) => {
    releaseCheckout = resolve;
  });
  await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.route('**/health', (route) => route.fulfill({ status: 200, body: 'fixture' }));
  await mockSignedInCabinet(page, { billing: { initialPlan: 'free' } });
  await page.route('**/api/v1/candidate/billing/checkouts', async (route) => {
    if (route.request().method() === 'POST') await checkoutWait;
    await route.fallback();
  });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await openTariffs(page);
  await openTariffLevel(page, 'basic', isMobile);
  const dialog = page.getByTestId('career-paywall-modal');
  await dialog.getByRole('button', { name: /Перейти на Basic/u }).click();
  const creating = dialog.getByRole('button', { name: /Перейти к оплате/u });
  const invoice = creating.click();
  await expect(dialog.getByRole('status')).toContainText('Создаём заказ.');
  await capture(page, 'payment-loading', viewport);
  releaseCheckout?.();
  await invoice;
  await expect(dialog.getByTestId('tariff-payment-pending')).toBeVisible();
});

test('B470: Executive displays the submitted state returned by B471', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const viewport = testInfo.project.name === 'mobile-390' ? '390' : '1440';
  const isMobile = viewport === '390';
  await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.route('**/health', (route) => route.fulfill({ status: 200, body: 'fixture' }));
  await mockSignedInCabinet(page, {
    billing: { initialPlan: 'free', executiveStatus: 'submitted' },
  });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await openTariffs(page);
  await openTariffLevel(page, 'exec', isMobile);

  const dialog = page.getByTestId('career-paywall-modal');
  await dialog
    .getByRole('textbox', { name: 'Расскажите о задаче' })
    .fill('Найти CTO для финтех-компании');
  await dialog.getByRole('textbox', { name: 'Цель и сроки' }).fill('До конца года');
  await dialog.getByRole('checkbox', { name: /Разрешаю команде видеть/u }).check();
  await dialog.getByRole('button', { name: 'Отправить заявку' }).click();
  await expect(dialog.getByTestId('executive-request-result')).toContainText('Заявка отправлена');
  await expect(dialog).not.toContainText('в течение недели на почту');
  await capture(page, 'executive-submitted', viewport);
  await expectNoHorizontalOverflow(page);
});

async function openTariffs(page: import('@playwright/test').Page): Promise<void> {
  const trigger = page
    .locator('.career-rail-wallet:visible, .career-mobile-tariffs:visible')
    .first();
  await expect(trigger).toBeVisible({ timeout: 20_000 });
  await trigger.click();
  await expect(page.locator('.career-tariffs:visible')).toBeVisible();
}

async function openTariffLevel(
  page: import('@playwright/test').Page,
  level: 'basic' | 'pro' | 'exec',
  isMobile: boolean,
): Promise<void> {
  if (isMobile) {
    const name = level === 'basic' ? 'Basic' : level === 'pro' ? 'Pro' : 'Executive';
    const mobile = page.locator('.career-tariffs-mobile:visible');
    const back = mobile.getByRole('button', { name: 'Назад к списку тарифов' });
    if (await back.count()) await back.click();
    await mobile.getByRole('button', { name: new RegExp('^' + name + '\\b', 'u') }).click();
    const actionName = level === 'exec' ? 'Оставить заявку' : 'Перейти на ' + name;
    await mobile.getByRole('button', { name: new RegExp(actionName, 'u') }).click();
    return;
  }
  const cardId = level === 'basic' ? 'go' : level;
  const card = page.locator('#lvl-' + cardId);
  if (
    !(await card
      .locator('summary')
      .evaluate((node) => node.parentElement?.hasAttribute('open') ?? false))
  ) {
    await card.locator('summary').click();
  }
  const actionName =
    level === 'exec' ? 'Оставить заявку' : 'Перейти на ' + (level === 'basic' ? 'Basic' : 'Pro');
  await card.getByRole('button', { name: new RegExp(actionName, 'u') }).click();
}

async function capture(
  page: import('@playwright/test').Page,
  state: string,
  viewport: string,
): Promise<void> {
  await page.screenshot({
    path: join(EVIDENCE_DIR, state + '-' + viewport + '.png'),
    fullPage: true,
  });
}

async function captureS10Tariffs(
  page: import('@playwright/test').Page,
  name: string,
): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 1440, height: 900 };
  const scrollHeight = await page.locator('#career-main').evaluate((main) => main.scrollHeight);
  await page.setViewportSize({
    width: viewport.width,
    height: Math.max(viewport.height, scrollHeight),
  });
  await page.screenshot({
    path: join(S10_EVIDENCE_DIR, `${name}.png`),
    fullPage: true,
  });
  await captureCareerHarness(page, join(S10_EVIDENCE_DIR, `${name}.html`));
  await page.setViewportSize(viewport);
}

async function expectConsentLayout(dialog: Locator, name: RegExp, viewport: string): Promise<void> {
  const checkbox = dialog.getByRole('checkbox', { name });
  const dimensions = await checkbox.evaluate((element) => {
    const checkboxRect = element.getBoundingClientRect();
    const text = element.closest('.career-upgrade-consent')?.querySelector('.career-checkbox-text');
    return {
      checkboxWidth: checkboxRect.width,
      textWidth: text?.getBoundingClientRect().width ?? 0,
    };
  });
  expect(dimensions.checkboxWidth).toBeLessThanOrEqual(44);
  expect(dimensions.textWidth).toBeGreaterThan(viewport === '390' ? 160 : 240);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function scrollTariffsToBottom(page: Page): Promise<void> {
  await page
    .locator('#career-main')
    .evaluate((main) => main.scrollTo({ top: main.scrollHeight, behavior: 'instant' }));
  await page.evaluate(() =>
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }),
  );
}
