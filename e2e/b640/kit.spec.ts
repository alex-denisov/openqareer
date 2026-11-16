import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';

const SHOTS = process.env.B640_SHOTS;

async function openKit(page: Page, query = ''): Promise<void> {
  await mockSignedInCabinet(page, { cabinetB640: true });
  await page.goto(`/app/kit${query}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-b640-kit]')).toBeVisible({ timeout: 15_000 });
}

const section = (page: Page, name: string) => page.locator(`[data-kit="${name}"]`);

test.describe('B649: витрина общих компонентов', () => {
  test('все секции на месте, горизонтальной прокрутки нет', async ({ page }) => {
    const views: Record<string, readonly string[]> = {
      '': [
        'settings-row',
        'paged-list',
        'toast',
        'result-line',
        'dialog',
        'info-tip',
        'row-action',
        'form-row',
        'theme',
        'action-dock',
      ],
      '?view=buttons': ['buttons', 'action-dock'],
      '?view=composer': ['composer'],
    };
    for (const [query, names] of Object.entries(views)) {
      await openKit(page, query);
      for (const name of names) {
        await expect(section(page, name).locator('h2')).toHaveCount(1);
      }
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, query).toBeLessThanOrEqual(0);
    }
  });

  test('окно: фокус внутрь, Tab не выходит, Esc закрывает и возвращает фокус', async ({ page }) => {
    await openKit(page);
    const opener = section(page, 'dialog').getByRole('button', { name: 'Выбрать резюме' });
    await opener.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(':focus')).toHaveCount(1);
    for (let step = 0; step < 8; step += 1) {
      await page.keyboard.press('Tab');
      await expect(dialog.locator(':focus')).toHaveCount(1);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test('тост: «Отменить» закрывает его', async ({ page }) => {
    await openKit(page);
    await section(page, 'toast').getByRole('button', { name: 'Скрыть вакансию' }).click();
    const toast = page.locator('.va-snack');
    await expect(toast).toContainText('Скрыто');
    await toast.getByRole('button', { name: 'Отменить' }).click();
    await expect(toast).toHaveCount(0);
  });

  test('ⓘ: фокус, нажатие закрепляет, Esc снимает', async ({ page }) => {
    await openKit(page);
    const tip = section(page, 'info-tip');
    const button = tip.getByRole('button', { name: 'Кому представить' });
    const bubble = tip.locator('.tip-bubble');
    await expect(bubble).toBeHidden();
    await button.focus();
    await expect(bubble).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(bubble).toBeHidden();
    await button.click();
    await page.mouse.move(5, 300);
    await expect(bubble).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(bubble).toBeHidden();
  });

  test('«Показать ещё» добавляет 20 строк', async ({ page }) => {
    await openKit(page);
    const list = section(page, 'paged-list');
    await expect(list.locator('li')).toHaveCount(20);
    await expect(list.locator('.ct-count')).toHaveText('20 из 45');
    await list.getByRole('button', { name: 'Показать ещё 20' }).click();
    await expect(list.locator('li')).toHaveCount(40);
  });

  test('панель ввода: Enter отправляет', async ({ page }) => {
    await openKit(page, '?view=composer');
    const field = section(page, 'composer').getByLabel('Ваш вопрос консультанту');
    await field.fill('Как сменить роль?');
    await field.press('Enter');
    await expect(section(page, 'composer').locator('.msg.me').last()).toHaveText(
      'Как сменить роль?',
    );
    await expect(field).toHaveValue('');
  });

  test('ряд полей: одинаковая высота и одна строка на широком окне', async ({ page }, testInfo) => {
    await openKit(page);
    const row = section(page, 'form-row');
    const boxes = await Promise.all(
      [row.locator('input[type=text]'), row.locator('select'), row.locator('.seg-ctl')].map((l) =>
        l.boundingBox(),
      ),
    );
    const heights = boxes.map((box) => Math.round(box?.height ?? 0));
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(8);
    if (testInfo.project.name === 'desktop-1440') {
      const tops = boxes.map((box) => Math.round(box?.y ?? 0));
      expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(8);
    }
    await expect(row.locator('label[for]').first()).toBeVisible();
  });

  test('замеры: строка результата, подвал окна, полоса действия, цели касания', async ({
    page,
  }, testInfo) => {
    await openKit(page);
    const result = await section(page, 'result-line').locator('.res-row').boundingBox();
    expect(result?.height ?? 99).toBeLessThanOrEqual(40);
    await page.goto('/app/kit?view=buttons', { waitUntil: 'domcontentloaded' });
    for (const button of await section(page, 'buttons').locator('.btn:not(.is-sm)').all()) {
      expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await page.goto('/app/kit', { waitUntil: 'domcontentloaded' });
    for (const action of await section(page, 'row-action').locator('.row-act:not(.is-sm)').all()) {
      expect((await action.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    const dock = section(page, 'action-dock').locator('.m-commit');
    if (testInfo.project.name === 'mobile-390') {
      await expect(dock).toHaveCSS('position', 'fixed');
      const dockBox = await dock.boundingBox();
      const nav = await page.locator('.b640 .bottomnav').boundingBox();
      expect((dockBox?.y ?? 0) + (dockBox?.height ?? 0)).toBeLessThanOrEqual((nav?.y ?? 0) + 1);
    }
    await section(page, 'dialog').getByRole('button', { name: 'Выбрать резюме' }).click();
    const footer = page.locator('.pf-dialog .pf-df');
    await expect(footer).toHaveCSS('padding-bottom', '16px');
    await expect(footer).toHaveCSS('padding-left', '16px');
    const box = await page.locator('.pf-dialog').boundingBox();
    const viewport = page.viewportSize();
    expect((box?.height ?? 0) + (box?.y ?? 0)).toBeLessThanOrEqual(viewport?.height ?? 0);
  });

  test('снимки витрины и окна: 1440, 1176, 390, светлая и тёмная', async ({ page }, testInfo) => {
    test.skip(
      !SHOTS || testInfo.project.name !== 'desktop-1440',
      'снимки снимаются по запросу: B640_SHOTS=1',
    );
    test.setTimeout(180_000);
    mkdirSync('.s13-shots', { recursive: true });
    const views = [
      { name: 'page', query: '' },
      { name: 'buttons', query: '?view=buttons' },
      { name: 'composer', query: '?view=composer' },
      { name: 'dialog', query: '?open=dialog' },
    ];
    for (const theme of ['light', 'dark']) {
      await mockSignedInCabinet(page, { cabinetB640: true });
      await page.addInitScript(
        (value) => window.localStorage.setItem('oq_b640_theme', value),
        theme,
      );
      for (const view of views) {
        for (const [width, height] of [
          [1440, 900],
          [1176, 900],
          [390, 844],
        ]) {
          await page.setViewportSize({ width, height });
          await page.goto(`/app/kit${view.query}`, { waitUntil: 'domcontentloaded' });
          await expect(page.locator('[data-b640-kit]')).toBeVisible({ timeout: 15_000 });
          await page.screenshot({
            path: `.s13-shots/kit-${view.name}-${width}-${theme}.png`,
            fullPage: view.name === 'page' || view.name === 'buttons',
          });
        }
      }
    }
  });
});
