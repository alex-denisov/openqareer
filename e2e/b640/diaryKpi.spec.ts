import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { mockDiary, type DiaryCalls } from './diaryFixture';
import { expectGates } from './gates';

const SHOTS = process.env.B640_SHOTS;

async function openKpi(page: Page, path: string, node: string): Promise<DiaryCalls> {
  await mockSignedInCabinet(page, { cabinetB640: true });
  const calls = await mockDiary(page);
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator(`.b640 [data-b640-node="${node}"]`)).toBeVisible({ timeout: 15_000 });
  return calls;
}

test.describe('B686: «Дневник» — загрузка и проверка KPI', () => {
  test('d02k → d02l → цели: текст разобран, строки приняты', async ({ page }, testInfo) => {
    const calls = await openKpi(page, '/app/diary/goals/import', 'd02k');
    const upload = page.locator('[data-b640-node="d02k"]');
    await expectGates(page);
    if (testInfo.project.name === 'desktop-1440') {
      // B645: подпись и поле как в макете d02k — 20 px от шапки, подпись 14/600, поле 96 px.
      const rect = (selector: string) =>
        upload.locator(selector).evaluate((element) => {
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return { top: box.top, bottom: box.bottom, height: box.height, size: style.fontSize };
        });
      const head = await rect('.lead-head');
      const label = await rect('label[for="kd-text"]');
      const field = await rect('#kd-text');
      expect(Math.round(label.top - head.bottom)).toBe(20);
      expect(label.size).toBe('14px');
      expect(Math.round(field.top - label.bottom)).toBe(8);
      expect(Math.round(field.height)).toBe(96);
    } else {
      // B645 (f4ca81f9) d02k на 390: поле 110 с y 177, «Разобрать» — правая половина панели (195, 179).
      const field = await upload.locator('#kd-text').boundingBox();
      expect(Math.abs(field!.y - 177)).toBeLessThanOrEqual(1);
      expect(Math.round(field!.height)).toBe(110);
      const go = await upload.getByRole('button', { name: 'Разобрать' }).boundingBox();
      expect([Math.round(go!.x), Math.round(go!.width)]).toEqual([195, 179]);
    }
    await upload.getByLabel('Текст').fill('Релиз — не дольше недели к концу января, вес 30 %.');
    await upload.getByRole('button', { name: 'Разобрать' }).click();

    const review = page.locator('[data-b640-node="d02l"]');
    if (testInfo.project.name === 'mobile-390') {
      await expect(review.locator('.kp-tbl')).toHaveCount(0);
      await expect(review.locator('.kp-row')).toHaveCount(4);
      const first = review.locator('.kp-row').first();
      const title = (await first.locator('.kp-t').textContent()) ?? '';
      const toggle = review.getByRole('switch', { name: `Верно: ${title}` });
      const box = await first.locator('.kp-ok').boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      await toggle.click();
      await expect(review.getByRole('button', { name: 'Принять 3' })).toBeVisible();
      await toggle.click();
      await first.locator('.kp-main').click();
      const sheet = page.getByRole('dialog', { name: 'Показатель' });
      await expect(sheet.getByLabel('Название')).toHaveValue(title);
      await sheet.getByRole('button', { name: 'Готово' }).click();
      await expect(sheet).toHaveCount(0);
      await review.getByRole('button', { name: 'Ещё действия: показатели' }).click();
      await expect(review.getByRole('menuitem', { name: 'Загрузить заново' })).toBeVisible();
    } else {
      await expect(review.locator('.kp-tbl tbody tr')).toHaveCount(4);
      if (testInfo.project.name === 'desktop-1440') {
        // B645: таблица с x 438, правый край 1094 в макете (за край формы на 16 px); у нас «руководитель»
        // длиннее макетного «директора» — край 1098, в поле страницы. Строки с y 262.
        const geometry = await review.evaluate((root) => {
          const box = (selector: string) => root.querySelector(selector)!.getBoundingClientRect();
          return { table: box('.kp-tbl'), row: box('.kp-tbl tbody tr'), form: box('form') };
        });
        expect(geometry.table.left).toBe(438);
        expect(Math.round(geometry.table.right)).toBeLessThanOrEqual(
          Math.round(geometry.form.right) + 20,
        );
        // Шрифты Linux-раннера сдвигают строку на 1 px — допуск 2 px.
        expect(Math.abs(geometry.table.top - 198)).toBeLessThanOrEqual(2);
        // B645 (f4ca81f9): значения в таблице видны целиком на 1440 и 1176.
        expect(await cutValues(page)).toEqual([]);
        await page.setViewportSize({ width: 1176, height: 900 });
        expect(await cutValues(page)).toEqual([]);
        await page.setViewportSize({ width: 1440, height: 900 });
      }
      const actions = review.locator('.m-commit > *');
      await expect(actions.first()).toHaveText('Принять 4');
      await expect(actions.nth(1)).toHaveText('Загрузить заново');
    }
    await expectGates(page);
    await review.getByRole('button', { name: 'Принять 4' }).click();
    await expect(page.locator('[data-b640-node="d02"]')).toBeVisible();
    expect(calls.kpi).toHaveLength(2);
  });

  test('снимки KPI: 1440, 1176, 390, светлая и тёмная', async ({ page }, testInfo) => {
    test.skip(
      !SHOTS || testInfo.project.name !== 'desktop-1440',
      'снимки снимаются по запросу: B640_SHOTS=1',
    );
    test.setTimeout(240_000);
    mkdirSync('.s13-shots', { recursive: true });
    const views = [
      ['d02k', '/app/diary/goals/import'],
      ['d02l', '/app/diary/goals/import/review?import=kpi-1'],
    ] as const;
    for (const theme of ['light', 'dark']) {
      await page.addInitScript(
        (value) => window.localStorage.setItem('oq_b640_theme', value),
        theme,
      );
      for (const [name, path] of views) {
        for (const [width, height] of [
          [1440, 900],
          [1176, 900],
          [390, 844],
        ]) {
          await page.unrouteAll({ behavior: 'ignoreErrors' });
          await page.setViewportSize({ width, height });
          await openKpi(page, path, name);
          await page.screenshot({
            path: `.s13-shots/${name}-${width}-${theme}.png`,
            fullPage: true,
          });
        }
      }
    }
  });
});

/** Поля и списки таблицы d02l, у которых значение не помещается: «ква» вместо «квартал». */
async function cutValues(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas').getContext('2d')!;
    const cut: string[] = [];
    for (const field of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      '.kp-tbl input, .kp-tbl select',
    )) {
      const style = getComputedStyle(field);
      const text =
        field instanceof HTMLSelectElement
          ? (field.selectedOptions[0]?.textContent ?? '')
          : field.value;
      canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const padding = parseFloat(style.paddingInlineStart) + parseFloat(style.paddingInlineEnd);
      // Стрелку списка рисует фон: если она есть, ей оставлено 16 px.
      const arrow = field instanceof HTMLSelectElement && style.backgroundImage !== 'none' ? 16 : 0;
      const room = field.clientWidth - padding - arrow;
      // WebKit считает рамку в scrollWidth поля: сверка с offsetWidth.
      if (canvas.measureText(text).width > room + 0.5 || field.scrollWidth > field.offsetWidth) {
        cut.push(
          `${field.getAttribute('aria-label')}: «${text}» в ${Math.round(field.clientWidth)} px`,
        );
      }
    }
    return cut;
  });
}
