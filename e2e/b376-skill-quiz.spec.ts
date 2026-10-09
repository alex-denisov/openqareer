import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

test.describe('B376 skill quiz dialogue & verification', () => {
  test('opens skill quiz from consultant, completes questions and accepts verification', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop-1440', 'single runner drives viewports');
    await mkdir('output/playwright/B376', { recursive: true });
    await mockSignedInCabinet(page);
    const applyRequests: string[] = [];
    page.on('request', (request) => {
      if (
        request.url().endsWith('/api/v1/candidate/skill-quiz/apply') &&
        request.method() === 'POST'
      ) {
        applyRequests.push(request.postData() ?? '');
      }
    });

    const viewports = [
      {
        name: 'desktop-1440',
        width: 1440,
        height: 900,
        shot: 'output/playwright/B376/b376-desktop-1440.png',
      },
      {
        name: 'laptop-1176',
        width: 1176,
        height: 800,
        shot: 'output/playwright/B376/b376-laptop-1176.png',
      },
      {
        name: 'mobile-390',
        width: 390,
        height: 844,
        shot: 'output/playwright/B376/b376-mobile-390.png',
      },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/app', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);

      // Navigate to Profile
      if (vp.width <= 640) {
        await page.locator('.career-mobile-nav').getByRole('button', { name: 'Профиль' }).click();
      } else {
        await page
          .locator('aside#career-rail nav')
          .getByRole('button', { name: 'Профиль' })
          .click();
      }
      await page.getByRole('tab', { name: /^Навыки/ }).click();
      await expect(page.locator('#sec-skills')).toBeVisible();

      // Open consultant
      const askBtn = page
        .getByRole('button', { name: /^(Спросить|Открыть) консультанта$/ })
        .first();
      await expect(askBtn).toBeVisible();
      await askBtn.click();

      const expertPanel = page.locator('aside.career-expert-panel');
      await expect(expertPanel).toBeVisible();
      await expect(expertPanel.locator('header strong')).toContainText('Профиль');

      // На 390 лист открывается свёрнутым (два положения): разворачиваем.
      const expand = expertPanel.getByRole('button', { name: 'Развернуть консультанта' });
      if (await expand.isVisible()) await expand.click();

      // Verify quiz prompt is present
      const quizPrompt = expertPanel.locator('.career-expert-skill-quiz-prompt');
      await expect(quizPrompt).toBeVisible();
      await expect(quizPrompt).toContainText(
        'Подтвердите заявленные навыки по банку квизов hh.ru и LinkedIn',
      );

      // Open quiz simulator
      const startQuizBtn = quizPrompt.getByRole('button', { name: 'Пройти квиз по навыку' });
      await startQuizBtn.click();

      const modal = page.locator('.career-quiz-modal-card');
      await expect(modal).toBeVisible();
      await expect(modal).toContainText('Верификация навыков: hh.ru и LinkedIn');

      // Start TypeScript quiz
      const startBtn = modal
        .locator('.career-quiz-item')
        .first()
        .getByRole('button', { name: 'Начать тест' });
      await startBtn.click();

      // Answer questions
      for (let i = 0; i < 4; i++) {
        await expect(modal.locator('.career-quiz-counter')).toBeVisible();
        // Select second option
        await modal.locator('.career-quiz-option').nth(1).click();
        if (i < 3) {
          await modal.getByRole('button', { name: 'Далее' }).click();
        } else {
          await modal.getByRole('button', { name: 'Завершить тест' }).click();
        }
      }

      // Check results view
      await expect(modal.locator('.career-quiz-result-title')).toBeVisible();
      await expect(modal).toContainText('Принять результат');

      // Take screenshot with result modal visible
      await page.screenshot({ path: vp.shot, fullPage: false });

      // Accept applies the result through the server exactly once, even when the disabled
      // control receives a second synthetic click while the request is pending.
      const requestCountBeforeApply = applyRequests.length;
      const applyResponsePromise = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v1/candidate/skill-quiz/apply') &&
          response.request().method() === 'POST',
      );
      await modal.getByRole('button', { name: 'Принять результат' }).click();
      const applyingButton = modal.getByRole('button', { name: 'Сохраняем…' });
      await expect(applyingButton).toBeDisabled();
      await applyingButton.evaluate((button) =>
        button.dispatchEvent(new MouseEvent('click', { bubbles: true })),
      );
      const appliedResponse = await applyResponsePromise;
      const applied = await appliedResponse.json();
      expect(appliedResponse.status()).toBe(201);
      expect(applyRequests).toHaveLength(requestCountBeforeApply + 1);
      expect(JSON.parse(applyRequests.at(-1) ?? '{}')).toMatchObject({
        quizId: 'typescript',
        skillName: 'TypeScript',
      });
      expect(applied.data.commandId).toBeTruthy();
      await expect(modal).not.toBeVisible();

      const appliedCard = expertPanel.locator('.career-expert-skill-quiz-result');
      await expect(appliedCard).toContainText('Навык обновлён: TypeScript');
      await appliedCard.getByRole('button', { name: 'Откатить' }).click();
      await expect(appliedCard).toContainText('Изменение отменено.');
      await expect(appliedCard.getByRole('button', { name: 'Откатить' })).toHaveCount(0);

      const repeatedRevert = await page.evaluate(async (commandId: string) => {
        const response = await fetch(
          `/api/v1/candidate/career-commands/${encodeURIComponent(commandId)}/revert`,
          { method: 'POST' },
        );
        return { status: response.status, body: await response.json() };
      }, applied.data.commandId);
      expect(repeatedRevert.status).toBe(409);
      expect(repeatedRevert.body.error.code).toBe('profile_revision_already_reverted');

      // Close consultant panel for next iteration
      await page.getByRole('button', { name: 'Закрыть карьерного консультанта' }).click();
      await expect(expertPanel).not.toBeVisible();
    }
  });
});
