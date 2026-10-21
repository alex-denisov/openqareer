import type { Page } from '@playwright/test';

/** B547: «Локации» — поиск находит место, отметка выбирает его (с релокацией для других стран). */
export async function pickLocation(page: Page, name: string): Promise<void> {
  const tree = page.getByTestId('location-tree-filter');
  await tree.getByRole('searchbox', { name: 'Страна, регион, штат или город' }).fill(name);
  const enable = tree.getByRole('button', { name: 'Включить' });
  if (await enable.isVisible()) await enable.click();
  await tree
    .getByRole('checkbox', { name: new RegExp(`^${name}`, 'u') })
    .first()
    .check();
}
