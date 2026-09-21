import { expect, test, type Page } from '@playwright/test';

/**
 * B160 §3 — the resume import runs for ~12 seconds in production. The cabinet
 * mounts the moment the wizard closes, reads the server once, and used to
 * print `0 · нет подтверждённых фактов` over a profile that did not exist yet.
 * This spec holds the import open and asserts «Главная» says it is importing
 * instead of stating a number it cannot know.
 */

const CANDIDATE = {
  username: 'busy.candidate',
  email: 'busy.candidate@example.com',
  displayName: 'Кандидат Импорта',
  role: 'candidate' as const,
  isTest: false,
  candidateId: 'candidate-b160-busy',
};

const RESUME =
  'Senior Software Engineer. 8 лет в TypeScript, React и распределённых системах. ' +
  'Вёл платформенную команду из шести инженеров и снизил время отклика сервиса вдвое.';

async function stubWithHeldImport(page: Page): Promise<() => Promise<void>> {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/v1/auth/me') return route.fulfill({ json: { data: CANDIDATE } });
    if (pathname === '/api/v1/candidate/resume/import') {
      await held;
      return route.fulfill({ json: { data: { factCount: 12 } } });
    }
    return route.fulfill({ json: { data: null } });
  });
  return async () => {
    release();
  };
}

async function completeWizard(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Хочу найти работу/ }).click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByRole('button', { name: 'Текстом' }).click();
  await page.locator('.career-source-step textarea').fill(RESUME);
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await expect(page.getByRole('heading', { name: 'Что должно измениться?' })).toBeVisible();
  await page.getByRole('button', { name: 'Собрать карьерную картину' }).click();
}

test.describe('B160 «Главная» during a running import', () => {
  test('says the import is running instead of claiming an empty profile', async ({ page }) => {
    const releaseImport = await stubWithHeldImport(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);

    await completeWizard(page);

    // «Пульт» свёл кандидата на «Главную»: то же обещание держит оценка
    // профиля, посчитанная по разобранному резюме (B179).
    const assessment = page.locator('.career-home-panel').filter({ hasText: 'Готовность профиля' });
    await expect(assessment).toBeVisible();
    await expect(assessment).toContainText('Профиль ещё загружается');
    await expect(assessment).not.toContainText('Профиль пуст');

    await releaseImport();

    await expect(assessment).toContainText('Профиль пуст');
    await expect(assessment).not.toContainText('Профиль ещё загружается');
  });
});
