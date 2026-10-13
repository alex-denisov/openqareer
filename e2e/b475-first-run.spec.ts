import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

const EVIDENCE_DIR = path.resolve(process.cwd(), 'docs/v1-release/tasks/evidence/B475');
const CLI_PATH = path.resolve(process.cwd(), 'src/features/onboarding/renderFirstRunCli.ts');
const BATCH_HTML_DIR = path.join(os.tmpdir(), 'oq-b475-html');

function readHtml(filename: string): string {
  return fs.readFileSync(path.join(BATCH_HTML_DIR, filename), 'utf8');
}

test.describe('B475: First Run Wizard Mockup 0 (1440 and 390)', () => {
  test.beforeAll(() => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.mkdirSync(BATCH_HTML_DIR, { recursive: true });
    execFileSync('npx', ['tsx', CLI_PATH, '--batch-dir', BATCH_HTML_DIR], {
      encoding: 'utf8',
      stdio: 'inherit',
    });
  });

  test('desktop 1440 renders intake, sources, consultant starters, and captures evidence', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'Desktop 1440 only');
    await page.setViewportSize({ width: 1440, height: 900 });

    const html = readHtml('desktop-1440-intake.html');
    await page.setContent(html, { waitUntil: 'load' });

    // No horizontal overflow
    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasOverflow).toBe(false);

    // 1. Goal and sources
    await expect(page.locator('text=Находка себя')).toBeVisible();
    await expect(page.locator('text=Цель').first()).toBeVisible();
    await expect(page.locator('text=Источник').first()).toBeVisible();
    await expect(page.locator('text=LinkedIn').first()).toBeVisible();
    await expect(page.locator('text=hh.ru').first()).toBeVisible();
    await expect(page.locator('text=Файл резюме').first()).toBeVisible();
    await expect(page.locator('text=Рассказать консультанту').first()).toBeVisible();

    // 2. Consultant starters
    await expect(page.locator('text=С чего начать?')).toBeVisible();
    await expect(page.locator('text=Что вы читаете в LinkedIn?')).toBeVisible();
    await expect(page.locator('text=Можно без LinkedIn?')).toBeVisible();

    // 3. Skip button & primary action
    await expect(page.getByTestId('source-next-btn')).toBeVisible();
    await expect(page.getByTestId('source-skip-btn')).toBeVisible();

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'first-run-desktop-1440.png'),
      fullPage: true,
    });
  });

  test('mobile 390 renders intake without overflow and captures evidence', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'Mobile 390 only');
    await page.setViewportSize({ width: 390, height: 844 });

    const html = readHtml('mobile-390-intake.html');
    await page.setContent(html, { waitUntil: 'load' });

    const overflowPx = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflowPx).toBeLessThanOrEqual(0);

    await expect(page.locator('text=Шаг 2 из 3')).toBeVisible();
    await expect(page.locator('text=Файл резюме')).toBeVisible();
    await expect(page.locator('text=Рассказать консультанту')).toBeVisible();

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'first-run-mobile-390.png'),
      fullPage: true,
    });
  });

  test('captures evidence for all special states (skeleton, loading, error, session, empty, partial)', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'Desktop 1440 only');
    await page.setViewportSize({ width: 1440, height: 900 });

    // Skeleton
    await page.setContent(readHtml('desktop-1440-skeleton.html'), { waitUntil: 'load' });
    await expect(page.locator('text=Проверяем вход и читаем ваш профиль')).toBeVisible();
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'first-run-desktop-1440-skeleton.png'),
      fullPage: true,
    });

    // Stale loading
    await page.setContent(readHtml('desktop-1440-loading.html'), { waitUntil: 'load' });
    await expect(page.locator('text=Читаем LinkedIn: раздел 2 из 5')).toBeVisible();
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'first-run-desktop-1440-loading.png'),
      fullPage: true,
    });

    // Error
    await page.setContent(readHtml('desktop-1440-error.html'), { waitUntil: 'load' });
    await expect(page.locator('text=Не удалось войти: сервер не ответил')).toBeVisible();
    await expect(page.getByTestId('error-retry-btn')).toBeVisible();
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'first-run-desktop-1440-error.png'),
      fullPage: true,
    });

    // Session expired
    await page.setContent(readHtml('desktop-1440-session.html'), { waitUntil: 'load' });
    await expect(page.locator('text=Вход устарел')).toBeVisible();
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'first-run-desktop-1440-session.png'),
      fullPage: true,
    });

    // Empty sources
    await page.setContent(readHtml('desktop-1440-empty.html'), { waitUntil: 'load' });
    await expect(page.locator('text=Источник не выбран')).toBeVisible();
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'first-run-desktop-1440-empty.png'),
      fullPage: true,
    });

    // Partial source
    await page.setContent(readHtml('desktop-1440-partial.html'), { waitUntil: 'load' });
    await expect(page.locator('text=LinkedIn подключён, hh.ru нет')).toBeVisible();
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'first-run-desktop-1440-partial.png'),
      fullPage: true,
    });
  });

  test('live app desktop 1440: first run flow, city search with region catalogue, consultant dialogue, skip dialog, file upload', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'Desktop 1440 only');
    await page.setViewportSize({ width: 1440, height: 900 });

    await mockSignedInCabinet(page);
    await page.addInitScript(() => {
      window.localStorage.setItem('openqareer_session_token', 'synthetic-b475-session');
    });

    await page.goto('/app?wizard=0', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('first-run-wizard')).toBeVisible();

    // 1. Consultant starters & composer
    const starterBtn = page.getByTestId('starter-С чего начать?');
    await expect(starterBtn).toBeVisible();
    await starterBtn.click();
    await expect(page.getByTestId('consultant-thread')).toContainText('Начнём с источника');

    const composerInput = page.getByTestId('consultant-composer-input');
    await composerInput.fill('Сколько длится диагностика?');
    await page.getByTestId('consultant-send-btn').click();
    await expect(page.getByTestId('consultant-thread')).toContainText(
      'Сколько длится диагностика?',
    );

    // 2. Skip dialog & undo toast
    await page.getByTestId('source-skip-btn').click();
    await expect(page.getByTestId('first-run-skip-dialog')).toBeVisible();
    await page.getByTestId('skip-confirm-btn').click();
    await expect(page.getByTestId('first-run-skipped-toast')).toBeVisible();

    // Undo skip: returns to source step
    await page.getByTestId('toast-undo-btn').click();
    await expect(page.getByTestId('source-next-btn')).toBeVisible();

    // 3. File upload via FirstRunSourceMenu
    await page.getByTestId('source-opt-file').click();
    await expect(page.getByTestId('first-run-source-menu')).toBeVisible();

    const fileInput = page.getByTestId('native-file-input');
    await fileInput.setInputFiles({
      name: 'candidate-cv.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 sample content'),
    });
    await expect(page.getByTestId('uploaded-file-info')).toContainText('candidate-cv.pdf');

    // Move to step 3: Context
    await page.getByTestId('source-next-btn').click();
    await expect(page.getByTestId('context-city-picker-btn')).toBeVisible();

    // 4. City Search with region directory
    await page.getByTestId('context-city-picker-btn').click();
    await expect(page.getByTestId('first-run-city-sheet')).toBeVisible();

    const citySearch = page.getByTestId('city-search-input');
    await citySearch.fill('Белград');
    const belgradeItem = page.getByTestId('city-item-Белград');
    await expect(belgradeItem).toBeVisible();
    await expect(belgradeItem).toContainText('Сербия');
    await belgradeItem.click();

    await expect(page.getByTestId('context-city-picker-btn')).toContainText('Белград');
    await expect(page.getByTestId('context-city-picker-btn')).toContainText('Сербия');

    // 5. Work format & relocation toggle
    await page.getByTestId('context-format-select').selectOption('Удалённо');
    await page.getByTestId('context-relocation-checkbox').check();
    await expect(page.getByTestId('context-relocation-checkbox')).toBeChecked();

    // 6. Submit first run
    await page.getByTestId('context-submit-btn').click();

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'first-run-live-desktop-1440.png'),
      fullPage: true,
    });
  });

  test('live app mobile 390: first run flow, source action sheet, consultant sheet, no horizontal overflow', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'Mobile 390 only');
    await page.setViewportSize({ width: 390, height: 844 });

    await mockSignedInCabinet(page);
    await page.addInitScript(() => {
      window.localStorage.setItem('openqareer_session_token', 'synthetic-b475-session');
    });

    await page.goto('/app?wizard=0', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('first-run-wizard')).toBeVisible();

    // Verify no horizontal overflow
    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasOverflow).toBe(false);

    // 1. Mobile Source menu action sheet
    await page.getByTestId('source-opt-file').click();
    await expect(page.getByTestId('first-run-source-menu')).toBeVisible();
    await expect(page.getByTestId('pick-files-btn')).toBeVisible();
    await expect(page.getByTestId('pick-photo-btn')).toBeVisible();
    await expect(page.getByTestId('scan-doc-btn')).toBeVisible();
    await page.getByRole('button', { name: 'Отмена' }).click();

    // 2. Mobile Consultant dialogue sheet
    await page.getByTestId('source-opt-talk').click();
    await expect(page.getByTestId('first-run-mobile-chat')).toBeVisible();
    await page.getByTestId('consultant-back-btn').click();
    await expect(page.getByTestId('first-run-mobile-chat')).toHaveCount(0);

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'first-run-live-mobile-390.png'),
      fullPage: true,
    });
  });
});
