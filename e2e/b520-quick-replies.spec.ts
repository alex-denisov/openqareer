import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { seedReadabilityWorkspace } from './helpers/seedReadabilityWorkspace';
import { waitForCareerShell } from './helpers/waitForCareerShell';

const evidenceDirectory = path.resolve('test-results/evidence/ACC-CHIPS-1');

test('keeps starters in the empty stream and sends current-turn quick replies', async ({
  page,
}, testInfo) => {
  await mkdir(evidenceDirectory, { recursive: true });

  const sentMessages: string[] = [];
  await mockSignedInCabinet(page);
  await seedReadabilityWorkspace(page);
  await page.route('**/api/v1/candidate/me/messages**', (route) =>
    route.fulfill({ json: { data: [], meta: { nextOffset: null } } }),
  );
  await page.route('**/api/v1/candidate/me/turns**', (route) =>
    route.fulfill({ json: { data: [], meta: { nextOffset: null } } }),
  );
  await page.route('**/api/v1/coach/turn*', async (route) => {
    const request = route.request().postDataJSON() as { content?: unknown };
    sentMessages.push(typeof request.content === 'string' ? request.content : '');

    const turnNumber = sentMessages.length;
    await route.fulfill({
      json: {
        data: {
          message: `Ответ ${turnNumber}`,
          phase: 'discovery',
          memoryCandidates: [],
          nextQuestion: 'Какой вариант ближе?',
          completeness: { known: [], unknown: [] },
          safety: { needsHuman: false, reason: null },
          careerTrack: null,
          actionProposals: [],
          ...(turnNumber === 1 || turnNumber === 3
            ? { quickReplies: ['Уточнить первый шаг?', 'Сравнить варианты?'] }
            : {}),
        },
      },
    });
  });

  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await waitForCareerShell(page);
  if (testInfo.project.name === 'mobile-390') {
    await page.getByRole('button', { name: 'Консультант: открыть' }).click();
  }

  const panel = page.locator('section.career-expert-panel');
  await expect(panel).toBeVisible();
  const starters = panel.getByRole('group', { name: 'Темы для начала' });
  await expect(starters).toBeVisible();
  await expect(starters.getByRole('button')).toHaveCount(3);
  await expect(starters.getByRole('button').first()).toHaveText('С чего начать сегодня?');
  await expect(panel.locator('.career-expert-composer .career-expert-chip-group')).toHaveCount(0);
  await page.screenshot({
    path: path.join(evidenceDirectory, `${testInfo.project.name}-empty.png`),
  });

  const input = panel.getByRole('textbox', { name: 'Сообщение карьерному консультанту' });
  await input.fill('Как выбрать следующий шаг?');
  await expect(starters).toHaveCount(0);
  await panel.getByRole('button', { name: 'Отправить вопрос' }).click();

  const quickReplies = panel.getByRole('group', { name: 'Варианты ответа' });
  await expect(panel.getByText('Ответ 1', { exact: true })).toBeVisible();
  await expect(
    panel.locator('.career-dialogue-turn.is-assistant').last().getByRole('group', {
      name: 'Варианты ответа',
    }),
  ).toBeVisible();
  await expect(quickReplies.getByRole('button')).toHaveCount(2);
  const targetHeight = await quickReplies
    .getByRole('button')
    .first()
    .evaluate((button) => button.getBoundingClientRect().height);
  expect(targetHeight).toBeGreaterThanOrEqual(44);

  const axeResults = await new AxeBuilder({ page })
    .include('.career-expert-quick-replies')
    .analyze();
  expect(axeResults.violations).toEqual([]);
  await page.screenshot({
    path: path.join(evidenceDirectory, `${testInfo.project.name}-quick-replies.png`),
  });

  await quickReplies.getByRole('button', { name: 'Уточнить первый шаг?' }).click();
  await expect(quickReplies).toHaveCount(0);
  await expect(panel.getByText('Ответ 2', { exact: true })).toBeVisible();
  expect(sentMessages).toEqual(['Как выбрать следующий шаг?', 'Уточнить первый шаг?']);
  await expect(panel.getByRole('group', { name: 'Варианты ответа' })).toHaveCount(0);
  await page.screenshot({
    path: path.join(evidenceDirectory, `${testInfo.project.name}-without-replies.png`),
  });

  await input.fill('Как продолжить разбор?');
  await panel.getByRole('button', { name: 'Отправить вопрос' }).click();
  await expect(panel.getByText('Ответ 3', { exact: true })).toBeVisible();
  await expect(quickReplies).toBeVisible();
  const panelBounds = await panel.boundingBox();
  const replyBounds = await quickReplies.boundingBox();
  expect(replyBounds?.y).toBeGreaterThanOrEqual(panelBounds?.y ?? 0);
  expect((replyBounds?.y ?? 0) + (replyBounds?.height ?? 0)).toBeLessThanOrEqual(
    (panelBounds?.y ?? 0) + (panelBounds?.height ?? 0),
  );

  await input.fill('Черновик ответа');
  await expect(quickReplies).toHaveCount(0);
  expect(sentMessages).toHaveLength(3);
  await page.screenshot({
    path: path.join(evidenceDirectory, `${testInfo.project.name}-typed.png`),
  });
});
