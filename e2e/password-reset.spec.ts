import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { candidate } from './fixtures/readabilityWorkspace';

async function saveRenderedHarness(page: import('@playwright/test').Page, path: string) {
  const stylesheetPaths = await page
    .locator('link[rel="stylesheet"]')
    .evaluateAll((links) => links.map((link) => new URL((link as HTMLLinkElement).href).pathname));
  const styles = stylesheetPaths
    .map((stylesheet) => readFileSync(resolve('dist', `.${stylesheet}`), 'utf8'))
    .map((css) => `<style>${css}</style>`)
    .join('\n');
  let html = await page.content();
  html = html.replace(/<link\b(?=[^>]*\brel="stylesheet")[^>]*>/gu, '');
  html = html.replace(/<link rel="modulepreload"[^>]*>/gu, '');
  html = html.replace('</head>', `${styles}</head>`);
  writeFileSync(path, html.replace(/<script\b[\s\S]*?<\/script>/gu, ''));
}

test('requests a reset email, opens its link, and sets a new password', async ({
  page,
}, testInfo) => {
  const token = `oqr_${'b'.repeat(43)}`;
  const mailbox: Array<{ recipient: string; href: string }> = [];
  let resetBody: { token: string; newPassword: string } | undefined;
  let session: typeof candidate | null = null;

  await mockSignedInCabinet(page);
  await page.addInitScript(() => window.localStorage.clear());
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: { data: session } }));
  await page.route('**/api/v1/auth/password-reset-requests', async (route) => {
    const body = route.request().postDataJSON() as { identifier: string };
    mailbox.push({
      recipient: body.identifier,
      href: new URL(`/reset-password?token=${token}`, route.request().url()).toString(),
    });
    return route.fulfill({
      status: 202,
      json: { data: { accepted: true, deliveryConfigured: true } },
    });
  });
  await page.route('**/api/v1/auth/password-resets', async (route) => {
    resetBody = route.request().postDataJSON() as { token: string; newPassword: string };
    session = candidate;
    return route.fulfill({
      json: { data: { ...candidate, sessionToken: 'synthetic-b438-session' } },
    });
  });

  await page.goto('/reset-password', { waitUntil: 'domcontentloaded' });
  await page.screenshot({ path: testInfo.outputPath('reset-request.png'), fullPage: true });
  await saveRenderedHarness(page, testInfo.outputPath('reset-request.html'));
  await page.getByLabel('Email аккаунта').fill('candidate@example.com');
  await page.getByRole('button', { name: 'Отправить ссылку для сброса' }).click();
  await expect(page.getByRole('status')).toContainText(
    'Если аккаунт существует, письмо со ссылкой отправлено на указанный email.',
  );
  expect(mailbox).toHaveLength(1);
  expect(mailbox[0]?.recipient).toBe('candidate@example.com');

  await page.goto(mailbox[0]!.href, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Новый пароль' })).toBeVisible();
  await saveRenderedHarness(page, testInfo.outputPath('reset-new-password.html'));
  const a11y = await new AxeBuilder({ page }).include('.auth-card').analyze();
  expect(
    a11y.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? '')),
  ).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('reset-new-password.png'), fullPage: true });
  await page.getByLabel('Новый пароль').fill('candidate-password-after-reset');
  await page.getByLabel('Повторите пароль').fill('candidate-password-after-reset');
  await page.getByRole('button', { name: 'Сохранить новый пароль' }).click();
  await page.waitForURL('**/app');

  expect(resetBody).toEqual({ token, newPassword: 'candidate-password-after-reset' });
});

test('an invalid reset link explains the problem and offers a fresh request', async ({
  page,
}, testInfo) => {
  await mockSignedInCabinet(page);
  await page.addInitScript(() => window.localStorage.clear());
  await page.route('**/api/v1/auth/password-resets', (route) =>
    route.fulfill({
      status: 400,
      json: {
        error: {
          code: 'password_reset_invalid',
          message: 'Ссылка недействительна. Запросите новую.',
          retryable: false,
        },
      },
    }),
  );

  await page.goto(`/reset-password?token=oqr_${'x'.repeat(43)}`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Новый пароль').fill('candidate-password-after-reset');
  await page.getByLabel('Повторите пароль').fill('candidate-password-after-reset');
  await page.getByRole('button', { name: 'Сохранить новый пароль' }).click();

  await expect(page.getByRole('alert')).toContainText('Ссылка недействительна. Запросите новую.');
  await page.screenshot({ path: testInfo.outputPath('reset-invalid-link.png'), fullPage: true });
  await saveRenderedHarness(page, testInfo.outputPath('reset-invalid-link.html'));
  await page.getByRole('button', { name: 'Запросить новую' }).click();
  await expect(page.getByLabel('Email аккаунта')).toBeVisible();
  expect(new URL(page.url()).searchParams.has('token')).toBe(false);
});
