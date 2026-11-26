import { expect, test } from '@playwright/test';
import { openStart } from './adaptationStartFixture';

/**
 * B733: нативное поле даты в .app (системный WebKit) берёт формат из региона macOS —
 * с английским регионом «День выхода» показывал «мм/дд/гггг». Поле кабинета всегда
 * «дд.мм.гггг», а в API уходит ISO.
 */
test.use({ browserName: 'webkit', locale: 'en-US', viewport: { width: 1440, height: 900 } });

test('d01 «День выхода» is дд.мм.гггг in WebKit with an en-US region, ISO in the API', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop-1440', 'one viewport is enough for the engine check');
  const { created } = await openStart(page);
  await page.getByRole('combobox', { name: 'Компания' }).fill('Норма');
  await page.getByLabel('Должность').fill('Руководитель разработки');
  const day = page.getByLabel('День выхода');
  await expect(day).toHaveAttribute('type', 'text');
  await expect(day).toHaveAttribute('placeholder', 'дд.мм.гггг');
  await day.pressSequentially('01122026');
  await expect(day).toHaveValue('01.12.2026');
  info.annotations.push({ type: 'measure', description: `shown: ${await day.inputValue()}` });
  await page.getByRole('button', { name: 'Собрать план' }).click();
  await expect.poll(() => created.length).toBe(1);
  expect((created[0] as { startDate: string }).startDate).toBe('2026-12-01');
});
