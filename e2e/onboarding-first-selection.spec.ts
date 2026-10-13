import { expect, test, type Page } from '@playwright/test';

const CANDIDATE = {
  username: 'first-run.candidate',
  email: 'first-run.candidate@example.test',
  displayName: 'First Run Candidate',
  role: 'candidate' as const,
  isTest: false,
  emailVerified: true,
  candidateId: 'candidate-s11-registration',
};

async function stubAnonymousCareerApi(page: Page): Promise<void> {
  let session: typeof CANDIDATE | null = null;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/auth/me') {
      await route.fulfill({ json: { data: session } });
      return;
    }
    if (url.pathname === '/api/v1/auth/register' && request.method() === 'POST') {
      session = CANDIDATE;
      await route.fulfill({ json: { data: session } });
      return;
    }
    if (url.pathname === '/api/v1/candidate/workspace') {
      await route.fulfill({ json: { data: null } });
      return;
    }
    if (url.pathname === '/api/v1/account') {
      await route.fulfill({ json: { data: session ? { profile: {}, sessions: [] } : null } });
      return;
    }
    await route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
  });
}

test.describe('S11-WIZ: account consent remains available from FirstRun', () => {
  test('opens registration from a FirstRun source and returns to the edited goal', async ({
    page,
  }) => {
    await stubAnonymousCareerApi(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('first-run-wizard')).toBeVisible();

    await page.getByTestId('edit-goal-btn').click();
    await page.getByTestId('goal-textarea').fill('Ищу продуктовую роль в Европе.');
    await page.getByTestId('save-goal-btn').click();
    await page.getByTestId('source-opt-hh').click();

    const access = page.locator('.career-account-access');
    await expect(access).toBeVisible();
    await access.getByRole('button', { name: 'Зарегистрироваться' }).click();
    await access.getByLabel('Как к вам обращаться').fill(CANDIDATE.displayName);
    await access.getByLabel('Email').fill(CANDIDATE.email);
    await access.getByLabel('Пароль (от 8 символов)').fill('synthetic-first-run-passphrase');
    await access.getByRole('button', { name: 'Создать аккаунт' }).click();
    await expect(access.getByText('Примите пользовательское соглашение')).toBeVisible();

    await access.locator('#signup-legal').check();
    await access.getByRole('button', { name: 'Создать аккаунт' }).click();
    await expect(access).toHaveCount(0);
    await expect(page.getByTestId('first-run-wizard')).toBeVisible();
    await expect(page.locator('.first-run-goal-text')).toContainText(
      'Ищу продуктовую роль в Европе.',
    );
    await expect(page.getByTestId('source-opt-hh')).toContainText('Подключить');
  });
});
