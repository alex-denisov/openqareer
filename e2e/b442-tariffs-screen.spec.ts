import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { renderTariffsStaticHtml } from '../src/features/tariffs/renderTariffsHtml';
import type { TariffSubscriptionInfo } from '../src/features/tariffs/tariffsData';

const sampleSubscription: TariffSubscriptionInfo = {
  activeUntil: '08.11',
  autoRenew: true,
  amount: '9 900 ₽',
  nextChargeDate: '08.11',
  paymentMethod: 'Карта РФ или СБП',
  todayUsage: { used: 27, total: 35 },
};

function renderTariffsHtml(props: Parameters<typeof renderTariffsStaticHtml>[0]): string {
  const appCss = readFileSync('src/App.css', 'utf8');
  const shellCss = readFileSync('src/features/shell/career-shell.css', 'utf8');
  const tariffsCss = readFileSync('src/features/tariffs/tariffs.css', 'utf8');
  const content = renderTariffsStaticHtml(props);

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Тарифы</title>
  <style>${appCss}</style>
  <style>${shellCss}</style>
  <style>${tariffsCss}</style>
</head>
<body style="margin: 0; padding: var(--career-space-4); background: var(--career-bg); color: var(--career-text-primary);">
  <main class="career-shell">
    ${content}
  </main>
</body>
</html>`;
}

test.describe('B442 tariffs screen (Desktop 1440 & Mobile 390)', () => {
  test.beforeAll(async () => {
    await mkdir('docs/v1-release/tasks/evidence/B442', { recursive: true });
  });

  test.beforeEach(() => {
    test.setTimeout(60000);
  });

  test('renders tariffs ladder on desktop 1440 without horizontal overflow and captures evidence', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'run once from desktop-1440');
    await page.setViewportSize({ width: 1440, height: 900 });

    // 1. Desktop Free tier active
    const htmlFree = renderTariffsHtml({ activeTierId: 'free' });
    await page.setContent(htmlFree, { waitUntil: 'load' });

    await expect(page.locator('#tariffs-page-title')).toHaveText('Тарифы');
    await expect(page.locator('.career-tariff-card')).toHaveCount(5);

    // Verify 5 tiers present
    await expect(page.locator('#lvl-free')).toContainText('Free');
    await expect(page.locator('#lvl-free')).toContainText('0 ₽');
    await expect(page.locator('#lvl-free')).toContainText('Ваш тариф');

    await expect(page.locator('#lvl-go')).toContainText('Basic');
    await expect(page.locator('#lvl-go')).toContainText('3 990 ₽');

    await expect(page.locator('#lvl-pro')).toContainText('Pro');
    await expect(page.locator('#lvl-pro')).toContainText('9 900 ₽');

    await expect(page.locator('#lvl-max')).toContainText('Max');
    await expect(page.locator('#lvl-max')).toContainText('39 900 ₽');

    await expect(page.locator('#lvl-exec')).toContainText('Executive');
    await expect(page.locator('#lvl-exec')).toContainText('150–300 тыс. ₽');

    // No horizontal overflow
    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasOverflow).toBe(false);

    await page.screenshot({
      path: 'docs/v1-release/tasks/evidence/B442/tariffs-desktop-1440-free.png',
      fullPage: true,
    });

    // 2. Desktop Pro tier active with subscription
    const htmlPro = renderTariffsHtml({
      activeTierId: 'pro',
      subscription: sampleSubscription,
    });
    await page.setContent(htmlPro, { waitUntil: 'load' });
    await expect(page.locator('#lvl-pro')).toContainText('Ваш тариф');
    await expect(page.locator('#lvl-pro')).toContainText('Действует до');
    await expect(page.locator('#lvl-pro')).toContainText('08.11');

    await page.screenshot({
      path: 'docs/v1-release/tasks/evidence/B442/tariffs-desktop-1440-pro.png',
      fullPage: true,
    });

    // 3. Desktop Compare open
    await page.locator('#cmp summary').click();
    await expect(page.locator('.career-cmp-grid')).toBeVisible();
    await expect(page.locator('.career-cmp-row.is-here')).toContainText('(вы здесь)');

    await page.screenshot({
      path: 'docs/v1-release/tasks/evidence/B442/tariffs-desktop-1440-compare.png',
      fullPage: true,
    });
  });

  test('renders tariffs layout on mobile 390 without horizontal overflow and captures evidence', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'run once from mobile-390');
    await page.setViewportSize({ width: 390, height: 844 });

    // 1. Mobile Home view (list of 5 tiers)
    const htmlHome = renderTariffsHtml({ activeTierId: 'free', initialView: 'home' });
    await page.setContent(htmlHome, { waitUntil: 'load' });

    await expect(page.locator('.career-mob-view[data-mv="home"]')).toBeVisible();
    await expect(page.locator('.career-mob-row')).toHaveCount(5);
    await expect(page.locator('.career-mob-link-row')).toContainText('Сравнить по шагам пути');

    // Check no horizontal overflow at 390
    const hasOverflow390 = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasOverflow390).toBe(false);

    await page.screenshot({
      path: 'docs/v1-release/tasks/evidence/B442/tariffs-mobile-390-home.png',
      fullPage: true,
    });

    // 2. Mobile Level detail view (lvl-pro)
    const htmlDetail = renderTariffsHtml({ activeTierId: 'free', initialView: 'lvl-pro' });
    await page.setContent(htmlDetail, { waitUntil: 'load' });

    await expect(page.locator('.career-mob-view[data-mv="lvl-pro"]')).toBeVisible();
    await expect(page.locator('.career-mob-back-btn')).toBeVisible();
    await expect(page.locator('.career-mob-action-btn')).toContainText('Перейти на Pro');

    await page.screenshot({
      path: 'docs/v1-release/tasks/evidence/B442/tariffs-mobile-390-level-detail.png',
      fullPage: true,
    });

    // 3. Mobile Comparison view (cmp)
    const htmlCmp = renderTariffsHtml({ activeTierId: 'free', initialView: 'cmp' });
    await page.setContent(htmlCmp, { waitUntil: 'load' });

    await expect(page.locator('.career-mob-view[data-mv="cmp"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Сравнение' })).toBeVisible();
    await expect(page.locator('.career-mob-group')).toHaveCount(5);

    await page.screenshot({
      path: 'docs/v1-release/tasks/evidence/B442/tariffs-mobile-390-compare.png',
      fullPage: true,
    });
  });
});
