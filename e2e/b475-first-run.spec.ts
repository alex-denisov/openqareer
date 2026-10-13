import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

const EVIDENCE_DIR =
  '/Users/alexeydenisov/Projects/openqareer/docs/v1-release/tasks/evidence/S11-WIZ-2';

async function saveRenderedHtml(page: Page, name: string): Promise<void> {
  const html = await page.evaluate(async () => {
    const css = await Promise.all(
      [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map(async (link) =>
        (await fetch(link.href)).text(),
      ),
    );
    const body = document.body.cloneNode(true) as HTMLElement;
    body.querySelectorAll('script').forEach((script) => script.remove());
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.join('\n')}</style></head><body>${body.innerHTML}</body></html>`;
  });
  fs.writeFileSync(path.join(EVIDENCE_DIR, `${name}.html`), html);
}

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
      const payload = request.postDataJSON() as { workspace: Record<string, unknown> };
      savedPayload = payload.workspace;
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

async function captureContext(page: Page, width: number): Promise<void> {
  await page.getByTestId('edit-goal-btn').click();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `step-1-goal-${width}.png`) });
  await page.getByTestId('save-goal-btn').click();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `step-2-source-${width}.png`) });
  await saveRenderedHtml(page, `step-2-source-${width}`);
  await page.getByTestId('source-skip-btn').click();
  await expect(page.getByTestId('first-run-skip-dialog')).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `skip-source-${width}.png`) });
  await page.getByTestId('skip-confirm-btn').click();
  await expect(page.getByTestId('context-city-picker-btn')).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `step-3-context-${width}.png`) });
  const trigger = page.getByTestId('context-city-picker-btn');
  await trigger.click();
  const cityPicker = page.getByTestId('first-run-city-sheet');
  await expect(page.getByTestId('first-run-skipped-toast')).toHaveCount(0);
  if (width === 1440) {
    const field = await trigger.boundingBox();
    const popup = await cityPicker.boundingBox();
    expect(field).not.toBeNull();
    expect(popup).not.toBeNull();
    expect(popup!.y).toBeGreaterThanOrEqual(field!.y + field!.height);
    expect(popup!.y + popup!.height).toBeLessThanOrEqual(900);
  } else {
    await expect(cityPicker).toHaveAttribute('aria-modal', 'true');
  }
  await page.getByTestId('city-search-input').fill('Белград');
  await expect(page.getByTestId('city-item-Белград')).toBeVisible();
  await expect(page.getByTestId('city-results-list').getByRole('button')).toHaveCount(1);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `city-list-${width}.png`) });
  await saveRenderedHtml(page, `city-list-${width}`);
  const accessibility = await new AxeBuilder({ page }).include('.first-run-city-layer').analyze();
  expect(accessibility.violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(cityPicker).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByTestId('city-search-input').fill('Белград');
  await page.getByTestId('city-item-Белград').click();
  await expect(cityPicker).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByTestId('first-run-skipped-toast')).toHaveCount(0);
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

    await captureContext(page, 1440);
    await page.getByTestId('context-format-select').selectOption('Удалённо');
    await page.getByTestId('context-relocation-checkbox').check();
    await page.getByTestId('context-submit-btn').click();

    await expect(page.getByTestId('first-run-wizard')).toHaveCount(0);
    await expect(page.getByTestId('career-shell')).toHaveAttribute(
      'data-shell-view',
      'opportunities',
    );
    expect(savedPayload()?.constraints).toContain('Белград');
    expect(savedPayload()?.constraints).toContain('Готов к релокации');
    expect(savedPayload()?.regions).toEqual(['eu']);
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
    await captureContext(page, 390);
    await page.getByTestId('edit-goal-btn').click();
    await page.getByTestId('save-goal-btn').click();

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
