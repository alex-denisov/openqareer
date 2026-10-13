import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

const EVIDENCE_DIR =
  '/Users/alexeydenisov/Projects/openqareer/docs/v1-release/tasks/evidence/S11-WIZ';

async function openNewCandidate(page: Page) {
  await mockSignedInCabinet(page, { candidateId: 'candidate-s11-wiz' });
  let savedPayload: Record<string, unknown> | null = null;
  await page.route('**/api/v1/candidate/workspace', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({ json: { data: savedPayload } });
      return;
    }
    if (request.method() === 'PUT') {
      savedPayload = (request.postDataJSON() as Record<string, unknown>) ?? {};
      await route.fulfill({ json: { data: savedPayload } });
      return;
    }
    await route.fulfill({ status: 405, json: { error: { code: 'method_not_allowed' } } });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('openqareer_session_token', 'synthetic-s11-wiz-session');
  });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('first-run-wizard')).toBeVisible();
  return () => savedPayload;
}

async function advanceWithoutSource(page: Page): Promise<void> {
  await page.getByTestId('source-skip-btn').click();
  await expect(page.getByTestId('first-run-skip-dialog')).toBeVisible();
  await page.getByTestId('skip-confirm-btn').click();
  await expect(page.getByTestId('context-city-picker-btn')).toBeVisible();
}

test.describe('B475 FirstRun in the live career shell', () => {
  test.beforeAll(() => fs.mkdirSync(EVIDENCE_DIR, { recursive: true }));

  test('desktop 1440 opens without query flags and completes a profile', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-1440', 'Desktop 1440 only');
    const savedPayload = await openNewCandidate(page);

    await expect(page.getByRole('heading', { name: 'Старт' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Разделы кабинета' })).toBeVisible();
    await expect(page.getByTestId('source-opt-linkedin')).toContainText('Подключить');
    await expect(page.getByTestId('source-opt-hh')).toContainText('Подключить');
    await expect(page).toHaveURL(/\/app$/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'first-run-1440.png') });

    await advanceWithoutSource(page);
    await page.getByTestId('context-city-picker-btn').click();
    await page.getByTestId('city-search-input').fill('Белград');
    await page.getByTestId('city-item-Белград').click();
    await page.getByTestId('context-format-select').selectOption('Удалённо');
    await page.getByTestId('context-relocation-checkbox').check();
    await page.getByTestId('context-submit-btn').click();

    await expect(page.getByTestId('first-run-wizard')).toHaveCount(0);
    await expect(page.getByTestId('career-shell')).toHaveAttribute(
      'data-shell-view',
      'opportunities',
    );
    expect(JSON.stringify(savedPayload())).toContain('Белград');
    expect(JSON.stringify(savedPayload())).toContain('Готов к релокации');
  });

  test('mobile 390 uses the subscribed viewport state and gives honest file actions', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'mobile-390', 'Mobile 390 only');
    await openNewCandidate(page);

    await expect(page.getByTestId('first-run-wizard')).toHaveAttribute('data-mobile', 'true');
    await expect(page.getByText('Старт').first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'first-run-390.png') });

    await page.getByTestId('source-opt-file').click();
    await page.getByTestId('pick-photo-btn').click();
    await expect(page.locator('.first-run-source-menu-notice')).toContainText(
      'Загрузка фотографий пока недоступна',
    );
    await page.getByTestId('scan-doc-btn').click();
    await expect(page.locator('.first-run-source-menu-notice')).toContainText(
      'Сканирование пока недоступно',
    );
    await page.getByRole('button', { name: 'Отмена' }).click();

    await page.getByTestId('source-opt-talk').click();
    await expect(page.locator('.career-expert-panel')).toHaveAttribute(
      'data-mobile-expanded',
      'true',
    );
  });
});
