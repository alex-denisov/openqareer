import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * G5 R1b on the block C demo stand (`npx tsx scripts/block-c-demo-server.ts`): the role sample
 * there is too thin for the role check, yet «Начать» in the quiz offer must start the check of
 * the vacancy's own skills. Runs only when BLOCK_C_STAND_URL points at a running stand.
 */
const STAND = process.env.BLOCK_C_STAND_URL;
test.use({ browserName: 'webkit', ...(STAND ? { baseURL: STAND } : {}) });

test('B549-r stand: «Пройти квиз по Kafka и Kubernetes» → the check starts on those skills', async ({
  page,
}, testInfo) => {
  test.skip(!STAND || testInfo.project.name !== 'desktop-1440', 'needs the block C stand');
  await page.goto('/app');
  await page.locator('button[aria-label="Вакансии"]:visible').first().click({ timeout: 20_000 });
  const row = page.locator('.vac-list-item', { hasText: 'Вектор Банк' }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  const trigger = row.locator('.vacancies-screen-row-trigger');
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  const expand = page.getByRole('button', { name: 'Развернуть консультанта' });
  if (await expand.isVisible().catch(() => false)) await expand.click();
  const offer = page.getByRole('region', { name: 'Пройти квиз по Kafka и Kubernetes' });
  await expect(offer).toBeVisible({ timeout: 20_000 });
  await offer.getByRole('button', { name: 'Начать' }).click();

  const check = page.getByTestId('role-skill-assessment');
  await expect(check).not.toContainText('Требований пока недостаточно');
  await page.getByLabel('Согласен передать ответы модели для проверки по критериям.').check();
  const started = page.waitForResponse((response) =>
    response.url().endsWith('/role-skill-assessments/start'),
  );
  await page.getByRole('button', { name: 'Начать проверку' }).click();
  expect((await (await started).json()).data.state).toBe('run');
  await expect(page.getByPlaceholder('Напишите ответ на вопрос…')).toBeVisible();
  await expect(check).toContainText('Кейс 1');
  await expect(check.locator('.career-role-assessment-flow-side')).toContainText('Kafka');
  await expect(check.locator('.career-role-assessment-flow-side')).toContainText('Kubernetes');
  mkdirSync('output/playwright/B549-r', { recursive: true });
  await page.screenshot({ path: 'output/playwright/B549-r/stand-quiz-start-1440.png' });
});
