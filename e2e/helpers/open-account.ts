import { expect, type Page } from '@playwright/test';

/** Desktop opens the account from the rail; 390 reaches it through the «Ещё» menu. */
export async function openAccountFromShell(page: Page): Promise<void> {
  if ((page.viewportSize()?.width ?? 1440) <= 760) {
    const more = page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', {
      name: 'Ещё',
    });
    await expect(more).toBeVisible({ timeout: 20_000 });
    await more.click();
    const item = page.getByRole('menuitem', { name: 'Аккаунт' });
    await expect(item).toBeEnabled({ timeout: 15_000 });
    await item.click();
    return;
  }
  const trigger = page.getByRole('button', { name: 'Открыть аккаунт' });
  await expect(trigger).toBeEnabled({ timeout: 20_000 });
  await trigger.click();
}
