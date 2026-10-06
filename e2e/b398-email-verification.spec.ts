import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Locator } from '@playwright/test';
import { candidate } from './fixtures/readabilityWorkspace';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

interface PendingCandidate {
  readonly username: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: 'candidate';
  readonly isTest: true;
  readonly candidateId: string;
  readonly emailVerified: boolean;
  readonly emailVerificationEmailSent: boolean;
  readonly emailVerificationResendAfterSeconds: number;
  readonly sessionToken: string;
}

async function expectMinimumHitArea(locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);
}

test('keeps a new account outside the cabinet until the email code is confirmed', async ({
  page,
}, testInfo) => {
  mkdirSync('output/B398', { recursive: true });
  await mockSignedInCabinet(page);
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  let currentUser: PendingCandidate | null = null;
  let candidateReads = 0;
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: { data: currentUser } }));
  await page.route('**/api/v1/auth/register', async (route) => {
    const body = route.request().postDataJSON() as { email: string; displayName: string };
    currentUser = {
      ...candidate,
      email: body.email,
      displayName: body.displayName,
      emailVerified: false,
      emailVerificationEmailSent: true,
      emailVerificationResendAfterSeconds: 60,
      sessionToken: 'synthetic-b398-session',
    };
    return route.fulfill({ status: 201, json: { data: currentUser } });
  });
  await page.route('**/api/v1/auth/email-verification/address', async (route) => {
    const body = route.request().postDataJSON() as { email: string };
    if (!currentUser)
      return route.fulfill({ status: 401, json: { error: { code: 'unauthorized' } } });
    currentUser = { ...currentUser, email: body.email };
    return route.fulfill({ json: { data: currentUser } });
  });
  await page.route('**/api/v1/auth/email-verification/verify', async (route) => {
    const body = route.request().postDataJSON() as { code: string };
    if (!currentUser)
      return route.fulfill({ status: 401, json: { error: { code: 'unauthorized' } } });
    if (body.code !== '123456') {
      return route.fulfill({
        status: 422,
        json: { error: { code: 'email_verification_invalid', message: 'Код не подходит.' } },
      });
    }
    currentUser = { ...currentUser, emailVerified: true, emailVerificationResendAfterSeconds: 0 };
    return route.fulfill({ json: { data: currentUser } });
  });
  await page.route('**/api/v1/candidate/**', async (route) => {
    candidateReads += 1;
    if (currentUser?.emailVerified !== true) {
      return route.fulfill({
        status: 403,
        json: { error: { code: 'email_unverified', message: 'Подтвердите email.' } },
      });
    }
    return route.fallback();
  });

  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email', { exact: true }).fill('new.candidate@example.com');
  await page.getByLabel('Как к вам обращаться').fill('Новый кандидат');
  await page.getByLabel('Пароль (от 8 символов)').fill('candidate-password-for-tests');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await page.waitForURL('**/verify-email');
  await expect(page.getByRole('heading', { name: 'Введите код из письма' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Код из письма' })).toBeVisible();
  const logoLink = page.getByRole('link', { name: 'openqareer' });
  await page.keyboard.press('Tab');
  await expect(logoLink).toBeFocused();
  await expect
    .poll(() => logoLink.evaluate((element) => getComputedStyle(element).outlineWidth))
    .not.toBe('0px');
  await expect(page.getByRole('button', { name: 'Подтвердить адрес' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Отправить ещё раз' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Изменить адрес' })).toBeVisible();
  await expect(page.locator('.career-cabinet')).toHaveCount(0);
  const targets = [
    page.getByRole('textbox', { name: 'Код из письма' }),
    page.getByRole('button', { name: 'Подтвердить адрес' }),
    page.getByRole('button', { name: 'Отправить ещё раз' }),
    page.getByRole('button', { name: 'Изменить адрес' }),
    page.getByRole('link', { name: 'openqareer' }),
  ];
  for (const target of targets) await expectMinimumHitArea(target);
  await page.screenshot({
    path: `output/B398/email-verification-${testInfo.project.name}.png`,
    fullPage: true,
  });

  const beforeVerification = await page.evaluate(async () => {
    const response = await fetch('/api/v1/candidate/me', {
      headers: { Authorization: 'Bearer synthetic-b398-session' },
    });
    return { status: response.status, body: await response.json() };
  });
  expect(beforeVerification.status).toBe(403);
  expect(beforeVerification.body.error.code).toBe('email_unverified');
  expect(candidateReads).toBe(1);

  await page.getByRole('button', { name: 'Изменить адрес' }).click();
  const addressTargets = [
    page.getByLabel('Новый email'),
    page.getByLabel('Текущий пароль'),
    page.getByRole('button', { name: 'Сохранить адрес' }),
    page.getByRole('button', { name: 'Вернуться к коду' }),
  ];
  for (const target of addressTargets) await expectMinimumHitArea(target);
  await page.getByLabel('Новый email').fill('new.address@example.org');
  await page.getByLabel('Текущий пароль').fill('candidate-password-for-tests');
  await page.getByRole('button', { name: 'Сохранить адрес' }).click();
  await expect(page.locator('.auth-notice')).toContainText('new.address@example.org');
  await expect(page.getByRole('textbox', { name: 'Код из письма' })).toBeVisible();

  await page.getByRole('textbox', { name: 'Код из письма' }).fill('123456');
  await page.getByRole('button', { name: 'Подтвердить адрес' }).click();
  await page.waitForURL('**/app');
  await expect(page.locator('.career-cabinet')).toBeVisible();
  await expect(page.locator('.career-intake')).toHaveCount(0);
  expect(candidateReads).toBeGreaterThan(1);
});
