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
  test('d02k → d02l → цели: текст разобран, строки приняты', async ({ page }) => {
    const calls = await openKpi(page, '/app/diary/goals/import', 'd02k');
    const upload = page.locator('[data-b640-node="d02k"]');
    await expectGates(page);
    await upload.getByLabel('Текст').fill('Релиз — не дольше недели к концу января, вес 30 %.');
    await upload.getByRole('button', { name: 'Разобрать' }).click();

    const review = page.locator('[data-b640-node="d02l"]');
    await expect(review.locator('.kp-tbl tbody tr')).toHaveCount(4);
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
