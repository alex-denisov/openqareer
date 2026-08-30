import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * B173 — the documents are only useful if a candidate (and a crawler) can
 * actually reach them, read them and see which edition they are reading.
 */
const DOCS = [
  { slug: 'terms', heading: 'Пользовательское соглашение' },
  { slug: 'privacy', heading: 'Политика обработки персональных данных' },
  { slug: 'consent', heading: 'Согласие на обработку персональных данных' },
  { slug: 'disclaimer', heading: 'Дисклеймер' },
] as const;

test.describe('published legal pack', () => {
  for (const doc of DOCS) {
    test(`/legal/${doc.slug} is served, dated and free of horizontal overflow`, async ({
      page,
    }) => {
      const response = await page.goto(`/legal/${doc.slug}`, { waitUntil: 'domcontentloaded' });

      expect(response?.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 1, name: doc.heading })).toBeVisible();
      await expect(page.locator('.legal-meta')).toContainText('Редакция 1.0');

      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
      expect(canonical).toBe(`https://openqareer.com/legal/${doc.slug}`);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test('the disclaimer carries no critical accessibility violation', async ({ page }) => {
    await page.goto('/legal/disclaimer', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();

    expect(
      results.violations.filter((violation) =>
        ['critical', 'serious'].includes(violation.impact ?? ''),
      ),
    ).toEqual([]);
  });

  test('the landing footer links every published document', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    for (const doc of DOCS) {
      await expect(page.locator(`.site-footer a[href="/legal/${doc.slug}"]`)).toHaveCount(1);
    }
  });

  test('the signup form refuses to register without accepting the pack', async ({ page }) => {
    await page.route('**/api/v1/auth/**', (route) => route.fulfill({ json: { data: null } }));
    await page.goto('/signup', { waitUntil: 'domcontentloaded' });

    await page.locator('#signup-email').fill('legal.candidate@example.com');
    await page.locator('#signup-password').fill('candidate-password-2026');
    await page.getByRole('button', { name: 'Создать аккаунт' }).click();

    await expect(page.locator('#signup-legal-error')).toContainText(
      'Примите пользовательское соглашение',
    );
    for (const doc of DOCS) {
      await expect(page.locator(`.auth-legal-consent a[href="/legal/${doc.slug}"]`)).toHaveCount(1);
    }
  });
});
