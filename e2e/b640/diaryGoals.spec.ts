import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { mockDiary, type DiaryCalls } from './diaryFixture';
import { expectGates } from './gates';

const SHOTS = process.env.B640_SHOTS;

async function openGoals(page: Page, path: string, node: string): Promise<DiaryCalls> {
  await mockSignedInCabinet(page, { cabinetB640: true });
  const calls = await mockDiary(page);
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator(`.b640 [data-b640-node="${node}"]`)).toBeVisible({ timeout: 15_000 });
  return calls;
}

test.describe('B662: «Дневник» — цели и показатели', () => {
  test('d02 → d02a: отстающая цель в заголовке, замер, в архив', async ({ page }) => {
    const calls = await openGoals(page, '/app/diary/goals', 'd02');
    const list = page.locator('[data-b640-node="d02"]');
    await expect(list.locator('.lead-title')).toHaveText('Отстаёт «Закрыть 2 вакансии в команду»');
    await expect(list.locator('.dn-goal')).toHaveCount(2);
    await expect(list.getByText('Перевести сборку на общий конвейер')).toBeVisible();
    await expectGates(page);

    await list.locator('.lead').getByRole('link').first().click();
    const card = page.locator('[data-b640-node="d02a"]');
    await expect(card.locator('.gt-h')).toHaveText('Закрыть 2 вакансии в команду');
    await expectGates(page);
    await card.getByRole('button', { name: 'Внести замер' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('input').first().fill('1');
    await dialog.getByRole('button', { name: 'Сохранить замер' }).click();
    await expect(dialog).toBeHidden();
    expect(calls.measurements).toEqual([expect.objectContaining({ value: 1 })]);

    await card.getByRole('button', { name: 'Ещё действия: цель' }).click();
    await page
      .getByRole('menuitem', { name: 'В архив' })
      .or(page.getByRole('button', { name: 'В архив' }))
      .first()
      .click();
    const reason = page.getByRole('dialog');
    await reason.getByLabel('Почему').fill('Директор перенёс найм');
    await reason.getByRole('button', { name: 'В архив', exact: true }).click();
    await expect.poll(() => calls.archived.length).toBe(1);
  });

  test('d02b: ошибки на месте, затем новая цель открывается карточкой', async ({ page }) => {
    const calls = await openGoals(page, '/app/diary/goals/new', 'd02b');
    const form = page.locator('[data-b640-node="d02b"]');
    await expectGates(page);
    await form.getByRole('button', { name: 'Сохранить цель' }).click();
    await expect(form.locator('.va-err').first()).toHaveText('Назовите цель');
    await form.getByLabel('Название').fill('Сократить время ревью');
    await form.getByLabel('Срок').fill('2099-03-31');
    await form.getByLabel('Показатель').first().fill('Время до ревью, часов');
    await form.getByLabel('Сейчас').first().fill('18');
    await form.getByLabel('Цель', { exact: true }).first().fill('4');
    await form.getByRole('button', { name: 'Сохранить цель' }).click();
    await expect(page).toHaveURL(/\/app\/diary\/goals\/goal-new$/u);
    expect(calls.goals).toEqual([expect.objectContaining({ title: 'Сократить время ревью' })]);
  });

  test('снимки целей: 1440, 1176, 390, светлая и тёмная', async ({ page }, testInfo) => {
    test.skip(
      !SHOTS || testInfo.project.name !== 'desktop-1440',
      'снимки снимаются по запросу: B640_SHOTS=1',
    );
    test.setTimeout(300_000);
    mkdirSync('.s13-shots', { recursive: true });
    const views = [
      ['d02', '/app/diary/goals'],
      ['d02a', '/app/diary/goals/goal-1'],
      ['d02b', '/app/diary/goals/new'],
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
          await openGoals(page, path, name);
          await page.screenshot({
            path: `.s13-shots/${name}-${width}-${theme}.png`,
            fullPage: true,
          });
        }
      }
    }
  });
});
