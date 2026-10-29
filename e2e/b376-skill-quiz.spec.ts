import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { waitForCareerShell } from './helpers/waitForCareerShell';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

// Block A, package 3: one «Подтвердить навык» entry, a quiz built for a profile skill,
// right answers only after the server scores the attempt.
const QUESTIONS = Array.from({ length: 8 }, (_, index) => ({
  id: `q${index + 1}`,
  question: `Что выберете в ситуации ${index + 1}?`,
  options: ['Первое', 'Второе', 'Третье', 'Четвёртое'],
}));

const CONFIRMATIONS = {
  passingScorePercent: 80,
  skills: [
    {
      id: 'sk-ts',
      name: 'TypeScript',
      status: null,
      source: 'hh.ru',
      verifiedAt: null,
      quizCheckable: true,
      lastAttempt: null,
      conversation: { name: 'TypeScript', state: 'not_checked', facts: [] },
    },
    {
      id: 'sk-lead',
      name: 'Executive Leadership',
      status: null,
      source: 'LinkedIn',
      verifiedAt: null,
      quizCheckable: false,
      lastAttempt: null,
      conversation: { name: 'Executive Leadership', state: 'not_checked', facts: [] },
    },
  ],
};

const RESULT = {
  scorePercent: 88,
  correctAnswersCount: 7,
  totalQuestions: 8,
  passed: true,
  status: 'подтверждён',
  source: 'квиз openqareer',
  verifiedAt: '2026-10-29',
  review: QUESTIONS.map((question, index) => ({
    questionId: question.id,
    question: question.question,
    selectedOptionIndex: 1,
    correctOptionIndex: index === 7 ? 2 : 1,
    isCorrect: index !== 7,
    explanation: 'Так принято в практике.',
  })),
};

async function stubSkillConfirmation(page: Page, applyRequests: string[]) {
  const json = (body: unknown, status = 200) => ({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  await page.route('**/api/v1/candidate/skill-confirmations', (route) =>
    route.fulfill(json({ data: CONFIRMATIONS })),
  );
  await page.route('**/api/v1/candidate/skill-quiz/generate', (route) =>
    route.fulfill(
      json(
        {
          data: {
            attemptId: '11111111-1111-4111-8111-111111111111',
            skillName: 'TypeScript',
            level: 'middle',
            passingScorePercent: 80,
            questions: QUESTIONS,
          },
        },
        201,
      ),
    ),
  );
  await page.route('**/api/v1/candidate/skill-quiz/attempts/*/submit', (route) =>
    route.fulfill(
      json({
        data: {
          attemptId: '11111111-1111-4111-8111-111111111111',
          skillName: 'TypeScript',
          result: RESULT,
        },
      }),
    ),
  );
  await page.route('**/api/v1/candidate/skill-quiz/attempts/*/apply', async (route) => {
    applyRequests.push(route.request().url());
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill(json({ data: { commandId: 'cmd-1', result: RESULT } }, 201));
  });
}

async function openSkills(page: Page, width: number) {
  if (width <= 640) {
    await page.locator('.career-mobile-nav').getByRole('button', { name: 'Профиль' }).click();
  } else {
    await page.locator('aside#career-rail nav').getByRole('button', { name: 'Профиль' }).click();
  }
  await page.getByRole('tab', { name: /^Навыки/ }).click();
}

test.describe('B376 skill confirmation: quiz built for a profile skill', () => {
  test('one entry explains both paths, the quiz is scored by the server and applied once', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop-1440', 'single runner drives viewports');
    await mkdir('output/playwright/B376', { recursive: true });
    await mockSignedInCabinet(page);
    const applyRequests: string[] = [];
    await stubSkillConfirmation(page, applyRequests);

    for (const vp of [
      { name: 'desktop-1440', width: 1440, height: 900 },
      { name: 'laptop-1176', width: 1176, height: 800 },
      { name: 'mobile-390', width: 390, height: 844 },
    ]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/app', { waitUntil: 'domcontentloaded' });
      await waitForCareerShell(page);
      await openSkills(page, vp.width);

      // The old bank of developer tests is gone from the profile.
      await expect(page.getByRole('button', { name: /^Пройти квиз/u })).toHaveCount(0);
      await page.getByRole('button', { name: 'Подтвердить навык', exact: true }).first().click();

      const dialog = page.getByRole('dialog', { name: 'Подтвердить навык' });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('Проверка openqareer, не сертификат');
      await expect(dialog.getByRole('button', { name: 'Разобрать в беседе' })).toBeVisible();

      await dialog.getByRole('combobox').selectOption('Executive Leadership');
      await expect(dialog).toContainText('Этот навык тестом не проверить');
      await expect(dialog.getByRole('button', { name: 'Пройти тест' })).toHaveCount(0);

      await dialog.getByRole('combobox').selectOption('TypeScript');
      await dialog.getByRole('button', { name: 'Пройти тест' }).click();
      const generated = page.waitForResponse((response) =>
        response.url().endsWith('/skill-quiz/generate'),
      );
      await dialog.getByRole('button', { name: 'Средний' }).click();
      expect(JSON.stringify(await (await generated).json())).not.toMatch(/correctOptionIndex/u);

      const questions = dialog.locator('.skill-confirm-question');
      await expect(questions).toHaveCount(8);
      for (let index = 0; index < 8; index += 1) {
        await questions.nth(index).getByRole('radio').nth(1).check();
      }
      await dialog.getByRole('button', { name: 'Сдать' }).click();
      await expect(dialog).toContainText('88%: верно 7 из 8. Порог пройден.');
      await page.screenshot({ path: `output/playwright/B376/b376-${vp.name}.png` });

      const before = applyRequests.length;
      const accept = dialog.getByRole('button', { name: 'Принять результат' });
      await accept.click();
      await accept
        .evaluate((button) => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
        .catch(() => undefined);
      await expect(dialog.getByRole('status')).toHaveText('Результат принят.');
      expect(applyRequests).toHaveLength(before + 1);

      await dialog.getByRole('button', { name: 'Закрыть' }).click();
      await expect(dialog).toHaveCount(0);
    }
  });
});
