import { expect, type Page } from '@playwright/test';

export async function waitForCareerShell(page: Page): Promise<void> {
  await expect(page.getByTestId('career-shell')).toBeVisible({ timeout: 15_000 });
}
