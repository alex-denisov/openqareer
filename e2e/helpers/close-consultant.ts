import type { Page } from '@playwright/test';

/** Desktop folds the panel into the strip; the 390 sheet closes from its header chevron. */
export async function closeConsultant(page: Page): Promise<void> {
  const panel = page.locator('.career-expert-panel');
  if ((page.viewportSize()?.width ?? 1440) <= 760) {
    await panel
      .getByRole('button', { name: 'Развернуть или свернуть консультанта' })
      .last()
      .click();
    return;
  }
  // Below 1280 the approved layout already keeps the consultant folded into its strip.
  if (await panel.getByRole('button', { name: 'Развернуть консультанта' }).isVisible()) return;
  await panel
    .getByRole('button', {
      name: /^(Закрыть карьерного консультанта|Свернуть консультанта в полосу)$/u,
    })
    .click();
}
