import type { Page } from '@playwright/test';

/** Запускает голосовой ввод через меню способа ввода у кнопки отправки (как в Telegram). */
export async function startVoiceFromMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Способ ввода' }).click();
  await page.getByRole('menuitemradio', { name: 'Голосовой ввод' }).click();
}
