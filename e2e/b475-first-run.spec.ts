import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { advanceFirstRunSource } from './helpers/advance-first-run-source.mjs';
import AxeBuilder from '@axe-core/playwright';
import { e2eEvidenceDirectory } from './fixtures/evidencePath';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

const EVIDENCE_DIR = e2eEvidenceDirectory('S11-WIZ-2');

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
  if (await page.getByTestId('edit-goal-btn').isVisible())
    await page.getByTestId('edit-goal-btn').click();
  await page
    .getByTestId('goal-textarea')
    .fill('Хочу понять, на какие руководящие роли могу идти. Ищу активно.');
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `step-1-goal-${width}.png`) });
  await page.getByTestId('save-goal-btn').click();
  if (width === 1440) {
    await expect(
      page.getByRole('complementary', { name: 'Консультант · Старт', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Начнём с источника.', { exact: false })).toBeVisible();
  }
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `step-2-source-${width}.png`) });
  await saveRenderedHtml(page, `step-2-source-${width}`);
  await advanceFirstRunSource(page, width === 390, async () => {
    await page.screenshot({ path: path.join(EVIDENCE_DIR, `skip-source-${width}.png`) });
  });
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
    // Sub-pixel layout rounding (900.09) is not a visible overflow; a whole pixel would be.
    expect(Math.floor(popup!.y + popup!.height)).toBeLessThanOrEqual(900);
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
    await page
      .getByTestId('goal-textarea')
      .fill('Хочу понять, на какие руководящие роли могу идти. Ищу активно.');
    await page.getByTestId('save-goal-btn').click();
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
    await page.getByRole('button', { name: 'Назад', exact: true }).click();

    await page.getByTestId('source-opt-file').click();
    await page.getByTestId('source-next-btn').click();
    await expect(page.getByTestId('pick-files-btn')).toBeVisible();
    await expect(page.getByTestId('pick-photo-btn')).toHaveCount(0);
    await expect(page.getByTestId('scan-doc-btn')).toHaveCount(0);
    await page.getByRole('button', { name: 'Отмена' }).click();

    await page.getByTestId('source-opt-talk').click();
    await page.getByTestId('source-next-btn').click();
    await expect(page.locator('.career-expert-panel')).toHaveAttribute(
      'data-mobile-expanded',
      'true',
    );
  });
});
