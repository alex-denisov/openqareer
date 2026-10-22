import { mkdirSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { DEFAULT_UPDATE_INFO } from '../src/features/appUpdate/appUpdateModel';
import { e2eEvidenceDirectory } from './fixtures/evidencePath';
import { renderAppUpdateStaticHtml } from '../src/features/appUpdate/renderAppUpdateHtml';
import type { AppUpdateStatusData } from '../src/features/appUpdate/appUpdateTypes';

const EVIDENCE_DIR = e2eEvidenceDirectory('B469');

mkdirSync(EVIDENCE_DIR, { recursive: true });

function renderFullPageHtml(status: AppUpdateStatusData): string {
  const appCss = readFileSync('src/App.css', 'utf8');
  const shellCss = readFileSync('src/features/shell/career-shell.css', 'utf8');
  const updateCss = readFileSync('src/features/appUpdate/appUpdate.css', 'utf8');
  const updateHtml = renderAppUpdateStaticHtml(status);

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Обновление приложения</title>
  <style>${appCss}</style>
  <style>${shellCss}</style>
  <style>${updateCss}</style>
</head>
<body style="margin: 0; background: var(--career-bg); color: var(--career-text-primary); font-family: var(--career-font-sans, sans-serif);">
  <div class="career-shell" style="min-height: 100vh;">
    <div style="padding: var(--career-space-4); max-width: 1400px; margin: 0 auto;">
      ${updateHtml}
      <div style="background: var(--career-bg-elevated); border: var(--career-border-width) solid var(--career-line-soft); border-radius: var(--career-radius-md); padding: var(--career-space-5); min-height: 360px;">
        <h2 style="font-size: var(--career-text-lg); margin-top: 0; color: var(--career-text-primary);">Сегодня</h2>
        <p style="color: var(--career-text-muted); font-size: var(--career-text-sm);">Рабочее пространство кандидата</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

async function verifyNoHorizontalOverflow(page: import('@playwright/test').Page): Promise<void> {
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasOverflow).toBe(false);
}

test.describe('B469: Desktop App Update Dialogs & Banners (1440)', () => {
  test.beforeEach(() => {
    test.setTimeout(60000);
  });

  test('renders available update banner and captures evidence', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'B469 is desktop only');
    await page.setViewportSize({ width: 1440, height: 900 });

    const html = renderFullPageHtml({
      state: 'available',
      modal: 'none',
      info: { ...DEFAULT_UPDATE_INFO, autoUpdateEnabled: false },
    });
    await page.setContent(html, { waitUntil: 'load' });

    await expect(page.locator('.career-app-update-banner')).toBeVisible();
    await expect(page.locator('.career-app-update-text strong')).toHaveText(
      'Доступна версия 1.0.1',
    );
    await expect(page.getByTestId('app-update-install-btn')).toBeVisible();
    await expect(page.getByTestId('app-update-enable-auto-btn')).toHaveCount(0);
    await expect(page.getByTestId('app-update-whats-new-btn')).toBeVisible();
    await expect(page.getByTestId('app-update-later-btn')).toBeVisible();

    await verifyNoHorizontalOverflow(page);
    await page.screenshot({
      path: `${EVIDENCE_DIR}/b469-desktop-1440-available.png`,
      fullPage: true,
    });
  });

  test('renders ready to restart banner and captures evidence', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'B469 is desktop only');
    await page.setViewportSize({ width: 1440, height: 900 });

    const html = renderFullPageHtml({
      state: 'ready',
      modal: 'none',
      info: DEFAULT_UPDATE_INFO,
    });
    await page.setContent(html, { waitUntil: 'load' });

    await expect(page.locator('.career-app-update-banner')).toBeVisible();
    await expect(page.locator('.career-app-update-text strong')).toHaveText(
      'Версия 1.0.1 загружена',
    );
    await expect(page.getByTestId('app-update-restart-btn')).toBeVisible();
    await expect(page.getByTestId('app-update-next-launch-btn')).toBeVisible();

    await verifyNoHorizontalOverflow(page);
    await page.screenshot({ path: `${EVIDENCE_DIR}/b469-desktop-1440-ready.png`, fullPage: true });
  });

  test('renders updated banner and captures evidence', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'B469 is desktop only');
    await page.setViewportSize({ width: 1440, height: 900 });

    const html = renderFullPageHtml({
      state: 'updated',
      modal: 'none',
      info: DEFAULT_UPDATE_INFO,
    });
    await page.setContent(html, { waitUntil: 'load' });

    await expect(page.locator('.career-app-update-banner')).toHaveClass(/is-ok/);
    await expect(page.locator('.career-app-update-text strong')).toHaveText('Обновлено до 1.0.1');
    await expect(page.getByTestId('app-update-whats-new-btn')).toBeVisible();
    await expect(page.getByTestId('app-update-close-btn')).toBeVisible();

    await verifyNoHorizontalOverflow(page);
    await page.screenshot({
      path: `${EVIDENCE_DIR}/b469-desktop-1440-updated.png`,
      fullPage: true,
    });
  });

  test('renders offline notice and captures evidence', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'B469 is desktop only');
    await page.setViewportSize({ width: 1440, height: 900 });

    const html = renderFullPageHtml({
      state: 'offline',
      modal: 'none',
      info: DEFAULT_UPDATE_INFO,
    });
    await page.setContent(html, { waitUntil: 'load' });

    await expect(page.locator('.career-app-update-note')).toContainText(
      'Не удалось проверить обновления: нет связи',
    );
    await verifyNoHorizontalOverflow(page);
    await page.screenshot({
      path: `${EVIDENCE_DIR}/b469-desktop-1440-offline.png`,
      fullPage: true,
    });
  });

  test('renders busy sending notice and captures evidence', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'B469 is desktop only');
    await page.setViewportSize({ width: 1440, height: 900 });

    const html = renderFullPageHtml({
      state: 'busy_sending',
      modal: 'none',
      info: DEFAULT_UPDATE_INFO,
    });
    await page.setContent(html, { waitUntil: 'load' });

    await expect(page.locator('.career-app-update-note')).toContainText(
      'Перезапуск отложен: сейчас отправляется отклик на hh.ru',
    );
    await verifyNoHorizontalOverflow(page);
    await page.screenshot({
      path: `${EVIDENCE_DIR}/b469-desktop-1440-busy-sending.png`,
      fullPage: true,
    });
  });

  test('renders idle up-to-date notice and captures evidence', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'B469 is desktop only');
    await page.setViewportSize({ width: 1440, height: 900 });

    const html = renderFullPageHtml({
      state: 'idle',
      modal: 'none',
      info: DEFAULT_UPDATE_INFO,
    });
    await page.setContent(html, { waitUntil: 'load' });

    await expect(page.locator('.career-app-update-note')).toContainText(
      'Установлена последняя версия 1.0.1',
    );
    await verifyNoHorizontalOverflow(page);
    await page.screenshot({ path: `${EVIDENCE_DIR}/b469-desktop-1440-idle.png`, fullPage: true });
  });

  test('renders whats new modal and captures evidence', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'B469 is desktop only');
    await page.setViewportSize({ width: 1440, height: 900 });

    const html = renderFullPageHtml({
      state: 'available',
      modal: 'whats_new',
      info: DEFAULT_UPDATE_INFO,
    });
    await page.setContent(html, { waitUntil: 'load' });

    await expect(page.locator('.career-app-update-modal-title')).toHaveText('Что нового в 1.0.1');
    await expect(page.getByTestId('app-update-modal-install-btn')).toBeVisible();
    await expect(page.getByTestId('app-update-modal-later-btn')).toBeVisible();
    await expect(page.locator('.career-app-update-log li')).toHaveCount(4);

    await verifyNoHorizontalOverflow(page);
    await page.screenshot({
      path: `${EVIDENCE_DIR}/b469-desktop-1440-whats-new.png`,
      fullPage: true,
    });
  });

  test('renders downloading modal with progress and captures evidence', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'B469 is desktop only');
    await page.setViewportSize({ width: 1440, height: 900 });

    const html = renderFullPageHtml({
      state: 'downloading',
      modal: 'downloading',
      info: { ...DEFAULT_UPDATE_INFO, progressPercent: 64, downloadedMb: 24 },
    });
    await page.setContent(html, { waitUntil: 'load' });

    await expect(page.locator('.career-app-update-modal-title')).toHaveText(
      'Загружаем версию 1.0.1',
    );
    await expect(page.getByTestId('app-update-cancel-download-btn')).toBeVisible();
    await expect(page.getByTestId('app-update-minimize-btn')).toBeVisible();
    await expect(
      page.getByRole('dialog').locator('.career-app-update-progress-row strong'),
    ).toHaveText('64 %');

    await verifyNoHorizontalOverflow(page);
    await page.screenshot({
      path: `${EVIDENCE_DIR}/b469-desktop-1440-downloading.png`,
      fullPage: true,
    });
  });

  test('renders error modal and captures evidence', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'B469 is desktop only');
    await page.setViewportSize({ width: 1440, height: 900 });

    const html = renderFullPageHtml({
      state: 'error',
      modal: 'error',
      info: DEFAULT_UPDATE_INFO,
    });
    await page.setContent(html, { waitUntil: 'load' });

    await expect(page.locator('.career-app-update-modal-title')).toHaveText(
      'Не удалось загрузить обновление',
    );
    await expect(page.getByTestId('app-update-retry-btn')).toBeVisible();
    await expect(page.getByTestId('app-update-error-later-btn')).toBeVisible();

    await verifyNoHorizontalOverflow(page);
    await page.screenshot({ path: `${EVIDENCE_DIR}/b469-desktop-1440-error.png`, fullPage: true });
  });

  test('renders required update modal and captures evidence', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'B469 is desktop only');
    await page.setViewportSize({ width: 1440, height: 900 });

    const html = renderFullPageHtml({
      state: 'required',
      modal: 'required',
      info: DEFAULT_UPDATE_INFO,
    });
    await page.setContent(html, { waitUntil: 'load' });

    await expect(page.locator('.career-app-update-modal-title')).toHaveText(
      'Нужно обновить приложение',
    );
    await expect(page.getByTestId('app-update-force-restart-btn')).toBeVisible();

    await verifyNoHorizontalOverflow(page);
    await page.screenshot({
      path: `${EVIDENCE_DIR}/b469-desktop-1440-required.png`,
      fullPage: true,
    });
  });
});
