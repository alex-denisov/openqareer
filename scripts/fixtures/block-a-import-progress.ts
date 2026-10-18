import { expect, type Page } from '@playwright/test';
import type { LinkedInImportProgressEvent } from '../../src/features/connections/linkedinImportProgress';

const events: readonly LinkedInImportProgressEvent[] = [
  {
    type: 'start',
    keys: ['experience', 'education', 'skills', 'languages', 'projects', 'courses', 'contactInfo'],
  },
  { type: 'read', key: 'experience' },
  { type: 'read', key: 'education' },
  { type: 'read', key: 'skills' },
];

/** A declared visual-test state through the real native progress reducer, without provider calls. */
export async function seedBlockAImportProgress(page: Page): Promise<void> {
  const hasDemoBootstrap = await page.evaluate(
    () => document.documentElement.dataset.blockAQaBootstrap === 'local-progress-events-v1',
  );
  if (hasDemoBootstrap) {
    await page.keyboard.press('Control+Alt+KeyI');
    await expect(page.locator('.career-profile-screen-import-live')).toContainText('3 из 7');
    return;
  }
  const moduleUrl = await page.evaluate(() => {
    if (!document.querySelector('script[src*="/@vite/client"]')) return undefined;
    return new URL('/src/features/connections/linkedinImportProgress.ts', location.href).href;
  });
  if (!moduleUrl || new URL(moduleUrl).origin !== new URL(page.url()).origin) {
    throw new Error(
      'Synthetic progress requires the local Vite runtime or the explicit disposable Demo bootstrap.',
    );
  }
  await page.evaluate(
    async ({ url, input }) => {
      const progress = (await import(url)) as {
        applyLinkedInImportProgress: (event: LinkedInImportProgressEvent) => void;
      };
      input.forEach((event) => progress.applyLinkedInImportProgress(event));
    },
    { url: moduleUrl, input: events },
  );
  await expect(page.locator('.career-profile-screen-import-live')).toContainText('3 из 7');
}
