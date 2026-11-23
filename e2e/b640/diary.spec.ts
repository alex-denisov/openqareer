import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { CURRENT_WEEK, mockDiary, type DiaryCalls } from './diaryFixture';
import { expectGates } from './gates';

const SHOTS = process.env.B640_SHOTS;

async function openDiary(page: Page, path: string, node: string): Promise<DiaryCalls> {
  await mockSignedInCabinet(page, { cabinetB640: true });
  const calls = await mockDiary(page);
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator(`.b640 [data-b640-node="${node}"]`)).toBeVisible({ timeout: 15_000 });
  return calls;
}

test.describe('B662: «Дневник» нового кабинета — записи и итог недели', () => {
  test('d00: лента по неделям, фильтр, быстрая запись и удаление с «Отменить»', async ({
    page,
  }) => {
    const calls = await openDiary(page, '/app/diary', 'd00');
    const screen = page.locator('[data-b640-node="d00"]');
    await expect(screen.locator('.dn-week').first()).toContainText('Неделя 5');
    await expect(screen.locator('.dn-entry')).toHaveCount(8);
    await expectGates(page);

    await screen.getByRole('button', { name: 'Проблема' }).click();
    await expect(screen.locator('.dn-entry')).toHaveCount(2);
    await screen.getByRole('button', { name: 'Все' }).click();
    await expect(screen.locator('.dn-entry')).toHaveCount(8);

    await screen.getByLabel('Новая запись').fill('Встреча с директором о целях');
    await screen.getByRole('button', { name: 'Записать' }).click();
    await expect(screen.locator('.dn-entry').first()).toContainText('Встреча с директором о целях');
    expect(calls.created).toHaveLength(1);

    const first = screen.locator('.dn-entry').first();
    await first.getByRole('button', { name: 'Удалить' }).click();
    await expect(screen.locator('.dn-entry')).toHaveCount(8);
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(screen.locator('.dn-entry')).toHaveCount(9);
  });

  test('d00d: итог недели — замер, что получилось, план; возврат в ленту', async ({ page }) => {
    const calls = await openDiary(page, `/app/diary/week?week=${CURRENT_WEEK}`, 'd00d');
    const screen = page.locator('[data-b640-node="d00d"]');
    await expect(screen.locator('.dn-fs h3')).toHaveText([
      'Замеры',
      'Что получилось',
      'Что мешает',
      /^План на неделю/u,
    ]);
    await expectGates(page);
    // B645: «Что мешает» с текстом макета d00d — 96 px на 1440 и 68 px на 390 (корень `data-mtight`).
    const mobile = (page.viewportSize()?.width ?? 1440) < 768;
    const blockers = screen.locator('#wk-bad');
    await blockers.fill('Тестовая среда общая с соседней командой: ждали 4 дня.');
    expect(Math.round((await blockers.boundingBox())?.height ?? 0)).toBe(mobile ? 68 : 96);
    await screen.getByLabel('Срок релиза, дней').fill('5');
    await screen.getByRole('button', { name: 'Сохранить итог' }).click();
    await expect(page.locator('[data-b640-node="d00"]')).toBeVisible();
    expect(calls.measurements).toEqual([expect.objectContaining({ value: 5 })]);
    expect(calls.weeks).toHaveLength(1);
  });

  test('снимки «Дневника»: 1440, 1176, 390, светлая и тёмная', async ({ page }, testInfo) => {
    test.skip(
      !SHOTS || testInfo.project.name !== 'desktop-1440',
      'снимки снимаются по запросу: B640_SHOTS=1',
    );
    test.setTimeout(240_000);
    mkdirSync('.s13-shots', { recursive: true });
    const views = [
      ['d00', '/app/diary'],
      ['d00d', `/app/diary/week?week=${CURRENT_WEEK}`],
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
          await openDiary(page, path, name);
          await page.screenshot({
            path: `.s13-shots/${name}-${width}-${theme}.png`,
            fullPage: true,
          });
        }
      }
    }
  });
});
