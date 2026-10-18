import { expect, type Page } from '@playwright/test';

// Mockup 0 opens FirstRun on step 1 «Цель»; the sources unlock only after the goal is saved.
export async function saveFirstRunGoal(
  page: Page,
  goal = 'Хочу понять, на какие руководящие роли могу идти. Ищу активно.',
): Promise<void> {
  await page.getByTestId('goal-textarea').fill(goal);
  await page.getByTestId('save-goal-btn').click();
  await expect(page.getByTestId('source-opt-file')).toBeVisible();
}

const PLATFORM_NAMES = { linkedin: 'LinkedIn', hh: 'hh.ru' } as const;

// 1440 connects a platform from its row; 390 (mockup 0, iOS list) first selects the row and
// connects from the bottom action «Подключить <платформа>».
export async function chooseFirstRunPlatform(
  page: Page,
  platform: keyof typeof PLATFORM_NAMES,
): Promise<void> {
  await page.getByTestId(`source-opt-${platform}`).click();
  if ((page.viewportSize()?.width ?? 1440) > 760) return;
  await page
    .getByRole('button', { name: `Подключить ${PLATFORM_NAMES[platform]}`, exact: true })
    .click();
}
