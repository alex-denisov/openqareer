import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

const interviewApplication = {
  id: 'application-b465-1',
  candidateId: 'candidate-b465-test',
  clusterId: null,
  stage: 'interview',
  closedReason: null,
  archiveReason: null,
  archivePreviousStage: null,
  processProfile: 'standard',
  vacancy: {
    title: 'Руководитель инженерной команды',
    company: 'Тестовая компания',
    companyHidden: false,
    url: 'https://example.test/jobs/b465',
    source: 'synthetic',
  },
  notes: null,
  followUpDueAt: null,
  stageChangedAt: '2026-10-01T10:00:00.000Z',
  version: 1,
  createdAt: '2026-09-20T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  followUp: null,
  whoseTurn: 'candidate',
  materials: { coverLetter: false, resume: false },
  nearestInterview: { id: 'interview-b465-1', scheduledAt: null, prepStatus: 'not_started' },
  archiveStaleDays: 30,
};

async function installSpeechStub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class FakeSpeechRecognition {
      static active: FakeSpeechRecognition | null = null;
      onresult: ((event: { results: Array<[{ transcript: string }]> }) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      lang = '';
      continuous = false;
      interimResults = false;

      start() {
        FakeSpeechRecognition.active = this;
      }

      stop() {
        this.onend?.();
      }

      abort() {
        this.onend?.();
      }

      emit(text: string) {
        this.onresult?.({ results: [[{ transcript: text }]] });
      }

      deny() {
        this.onerror?.({ error: 'not-allowed' });
      }
    }
    Object.assign(window, {
      SpeechRecognition: FakeSpeechRecognition,
      b465EmitSpeech: (text: string) => FakeSpeechRecognition.active?.emit(text),
      b465DenySpeech: () => FakeSpeechRecognition.active?.deny(),
    });
  });
}

async function openPreparation(page: Page, width: number): Promise<void> {
  await installSpeechStub(page);
  await mockSignedInCabinet(page);
  await page.route('**/api/v1/candidate/applications*', (route) =>
    route.fulfill({ json: { data: [interviewApplication] } }),
  );
  await page.setViewportSize({ width, height: width <= 760 ? 844 : 900 });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  const nav =
    width <= 760 ? page.locator('.career-mobile-nav') : page.locator('aside#career-rail nav');
  await nav.getByRole('button', { name: 'Отклики' }).click();
  const card = page
    .locator('.career-responses-card')
    .filter({ hasText: interviewApplication.vacancy.title });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Подготовиться' }).click();
  await expect(page.getByRole('dialog', { name: /Интервью/u })).toBeVisible();
}

async function startSimulator(page: Page): Promise<void> {
  await page
    .getByRole('dialog', { name: /Интервью/u })
    .getByRole('button', { name: 'Начать мок-интервью' })
    .click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Мок-интервью', exact: true }),
  ).toBeVisible();
}

async function capture(page: Page, name: string): Promise<void> {
  const directory = process.env.B465_EVIDENCE_DIR;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true });
  writeFileSync(join(directory, `${name}.html`), await snapshotPage(page));
}

async function snapshotPage(page: Page): Promise<string> {
  return page.evaluate(() => {
    const rules = Array.from(document.styleSheets).flatMap((sheet) => {
      try {
        return Array.from(sheet.cssRules, (rule) => rule.cssText);
      } catch {
        return [];
      }
    });
    const clone = document.documentElement.cloneNode(true) as HTMLElement;
    clone
      .querySelectorAll('script, link[rel="stylesheet"], style')
      .forEach((node) => node.remove());
    const styles = document.createElement('style');
    styles.textContent = rules.join('\n');
    clone.querySelector('head')?.append(styles);
    return `<!doctype html>${clone.outerHTML}`;
  });
}

async function expectNoOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

async function expectAccessible(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).include('.career-mock-dialog').analyze();
  expect(
    result.violations
      .filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))
      .map((violation) => ({
        id: violation.id,
        targets: violation.nodes.map((node) => node.target),
      })),
  ).toEqual([]);
}

async function checkAndCapture(page: Page, name: string, audit = false): Promise<void> {
  await expectNoOverflow(page);
  if (audit) await expectAccessible(page);
  await capture(page, name);
}

async function enterSpeechText(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => {
    const target = window as Window & { b465EmitSpeech?: (transcript: string) => void };
    target.b465EmitSpeech?.(value);
  }, text);
  await expect(page.locator('.career-mock-transcript')).toContainText(text);
}

async function denyMicrophone(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as Window & { b465DenySpeech?: () => void };
    target.b465DenySpeech?.();
  });
  await expect(page.getByText(/Микрофон недоступен/u)).toBeVisible();
}

async function createStarStoryFromSimulator(page: Page): Promise<void> {
  await page
    .locator('.career-mock-source-panel')
    .getByRole('button', { name: 'Добавить историю' })
    .click();
  const storiesDialog = page.getByRole('dialog', { name: 'STAR-истории' });
  await expect(storiesDialog).toBeVisible();
  await storiesDialog.getByRole('button', { name: 'Добавить историю' }).click();
  const editor = page.getByRole('dialog', { name: 'Новая STAR-история' });
  await expect(editor).toBeVisible();
  await editor.getByLabel('Название истории').fill('Сокращение цикла релиза');
  await editor.getByLabel('Ситуация').fill('Команда выпускала обновления раз в две недели.');
  await editor.getByLabel('Задача').fill('Ускорить поставку и сохранить качество.');
  await editor.getByLabel('Действие').fill('Автоматизировал проверки и выкладку.');
  await editor.getByLabel('Результат').fill('Цикл релиза стал короче.');
  await editor.getByRole('button', { name: 'Сохранить историю' }).click();
  await expect(storiesDialog.getByText('Сокращение цикла релиза')).toBeVisible();
  await storiesDialog.getByRole('button', { name: 'Закрыть STAR-истории' }).click();
}

async function finishWithPartialAnswers(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Следующий вопрос' }).click();
  await expect(page.getByRole('heading', { name: /Вопрос 2 из/u })).toBeVisible();
  await page.getByRole('button', { name: 'Остановиться' }).click();
  await expect(page.getByRole('heading', { name: 'Тренировка остановлена' })).toBeVisible();
}

async function resumeAndFinish(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Продолжить с вопроса 2/u }).click();
  await expect(page.getByRole('button', { name: 'Пропустить вопрос' })).toBeVisible();
  for (let index = 0; index < 4; index += 1) {
    await page.getByRole('button', { name: 'Пропустить вопрос' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Мок-интервью завершено' })).toBeVisible();
}

test('runs text and voice interview screens through a partial result at 1440 and 390', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop-1440', 'This flow drives and captures both viewports.');
  test.setTimeout(240_000);
  for (const width of [1440, 390]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await openPreparation(page, width);
      await startSimulator(page);
      await checkAndCapture(page, `${width}-empty-setup`, true);
      await createStarStoryFromSimulator(page);
      await expect(page.locator('.career-mock-source-panel')).toContainText('1 всего');
      await page.getByRole('radio', { name: 'Только поведенческие' }).check();
      await page.getByRole('checkbox', { name: /Стресс-режим/u }).check();
      const startRequest = page.waitForRequest((request) => {
        const url = new URL(request.url());
        return (
          url.pathname === '/api/v1/candidate/interview-sessions' && request.method() === 'POST'
        );
      });
      await page.getByRole('button', { name: 'Начать', exact: true }).click();
      const request = await startRequest;
      expect(request.postDataJSON()).toMatchObject({
        mode: 'text',
        questionTypes: ['behavioral'],
        stressMode: true,
      });
      await expect(page.getByLabel('Ваш ответ')).toBeVisible();
      await checkAndCapture(page, `${width}-text-question`);
      await page
        .getByLabel('Ваш ответ')
        .fill('Автоматизировал проверки и ускорил выпуск обновлений.');
      await page.getByRole('button', { name: 'Отправить ответ' }).click();
      await expect(page.getByRole('heading', { name: 'Разбор ответа' })).toBeVisible();
      await checkAndCapture(page, `${width}-review`, true);
      await finishWithPartialAnswers(page);
      await checkAndCapture(page, `${width}-interrupted`);
      await resumeAndFinish(page);
      await expect(page.locator('.career-mock-topic-list')).toContainText(
        '1 вопрос оценено по рубрике.',
      );
      await expect(page.getByRole('button', { name: 'Записать в дневник' })).toHaveCount(0);
      await checkAndCapture(page, `${width}-partial-result`, true);
      await page.getByRole('button', { name: 'Пройти заново' }).click();
      await page.getByRole('radio', { name: /Голосом/u }).check();
      await page.getByRole('button', { name: 'Начать', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Начать запись' })).toBeVisible();
      await checkAndCapture(page, `${width}-voice-question`);
      await page.getByRole('button', { name: 'Начать запись' }).click();
      await denyMicrophone(page);
      await checkAndCapture(page, `${width}-microphone-denied`, true);
      await page.getByRole('button', { name: 'Начать запись' }).click();
      await page.getByRole('button', { name: 'Остановить запись' }).click();
      await expect(page.getByText(/Речь не распознана/u)).toBeVisible();
      await checkAndCapture(page, `${width}-no-speech`);
      await page.getByRole('button', { name: 'Начать запись' }).click();
      await enterSpeechText(page, 'Сократил цикл релиза с 14 до 3 дней.');
      await checkAndCapture(page, `${width}-voice-transcript`);
      await page.getByRole('button', { name: 'Закончить ответ' }).click();
      await expect(page.getByRole('heading', { name: 'Разбор ответа' })).toBeVisible();
    } finally {
      await context.close();
    }
  }
});

async function delaySessionLoad(page: Page): Promise<void> {
  await page.route('**/api/v1/candidate/interview-sessions/current', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    if (!page.isClosed()) await route.fallback();
  });
}

async function delayQuestionStart(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === '/api/v1/candidate/interview-sessions',
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      if (!page.isClosed()) await route.fallback();
    },
  );
}

async function failFirstAnswerForModel(page: Page): Promise<void> {
  let failed = false;
  await page.route(
    (url) => /\/api\/v1\/candidate\/interview-sessions\/[^/]+\/answers$/u.test(url.pathname),
    async (route) => {
      if (failed) return route.fallback();
      failed = true;
      return route.fulfill({
        status: 503,
        json: {
          error: {
            code: 'interview_model_unavailable',
            message: 'Оценка ответа временно недоступна.',
          },
        },
      });
    },
  );
}

async function failSessionLoad(page: Page): Promise<void> {
  await page.route('**/api/v1/candidate/interview-sessions/current', (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: 'service_unavailable', message: 'Сервис временно недоступен.' } },
    }),
  );
}

async function failStartWithPaywall(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === '/api/v1/candidate/interview-sessions',
    (route) =>
      route.fulfill({
        status: 402,
        json: { error: { code: 'paywall_required', message: 'Требуется тариф.' } },
      }),
  );
}

async function completeFailureState(
  page: Page,
  width: number,
  state: 'loading' | 'question-loading' | 'error' | 'paywall' | 'model',
): Promise<void> {
  await openPreparation(page, width);
  if (state === 'loading') await delaySessionLoad(page);
  if (state === 'error') await failSessionLoad(page);
  await startSimulator(page);
  if (state === 'loading') {
    await expect(page.locator('.career-mock-loading-card')).toContainText(
      'Загружаем сохранённую тренировку',
    );
  } else if (state === 'error') {
    await expect(
      page.getByRole('heading', { name: 'Сохранённую тренировку не удалось загрузить' }),
    ).toBeVisible();
  } else if (state === 'question-loading') {
    await delayQuestionStart(page);
    await page.getByRole('button', { name: 'Начать', exact: true }).click();
    await expect(page.locator('.career-mock-loading-card')).toContainText('Вопрос готовится');
  } else if (state === 'model') {
    await failFirstAnswerForModel(page);
    await page.getByRole('button', { name: 'Начать', exact: true }).click();
    await page
      .getByLabel('Ваш ответ')
      .fill('Автоматизировал проверки и ускорил выпуск обновлений.');
    await page.getByRole('button', { name: 'Отправить ответ' }).click();
    await expect(page.getByRole('button', { name: 'Повторить оценку' })).toBeVisible();
    await checkAndCapture(page, `${width}-model-error`);
    await page.getByRole('button', { name: 'Повторить оценку' }).click();
    await expect(page.getByRole('heading', { name: 'Разбор ответа' })).toBeVisible();
    await capture(page, `${width}-model-recovered`);
    return;
  } else {
    await failStartWithPaywall(page);
    await page.getByRole('button', { name: 'Начать', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Мок-интервью недоступно на текущем тарифе' }),
    ).toBeVisible();
  }
  await checkAndCapture(page, `${width}-${state}`, state === 'error' || state === 'paywall');
}

test('shows loading, error and tariff-limit states at both viewport sizes', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop-1440', 'This flow drives and captures both viewports.');
  test.setTimeout(240_000);
  for (const width of [1440, 390]) {
    for (const state of ['loading', 'question-loading', 'error', 'paywall', 'model'] as const) {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await completeFailureState(page, width, state);
      } finally {
        await context.close();
      }
    }
  }
});

async function installManyStories(page: Page): Promise<void> {
  const stories = Array.from({ length: 18 }, (_, index) => ({
    id: `story-${index + 1}`,
    title: `История ${index + 1}`,
    version: 1,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    fields: {
      situation: 'Команда столкнулась с задержками в работе.',
      task: 'Сократить время выполнения задачи.',
      action: 'Проанализировал процесс и изменил порядок действий.',
      result: 'Команда достигла согласованного результата.',
    },
    sourceFactIds: [],
    confidence: 'unconfirmed',
    sourceFacts: [],
  }));
  await page.route('**/api/v1/candidate/star-stories', (route) =>
    route.fulfill({ json: { data: { stories, facts: [] } } }),
  );
}

test('renders the many-stories setup without overflow at both viewport sizes', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop-1440', 'This flow drives and captures both viewports.');
  for (const width of [1440, 390]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await mockSignedInCabinet(page);
      await installManyStories(page);
      await page.route('**/api/v1/candidate/applications*', (route) =>
        route.fulfill({ json: { data: [interviewApplication] } }),
      );
      await page.setViewportSize({ width, height: width <= 760 ? 844 : 900 });
      await page.goto('/app', { waitUntil: 'domcontentloaded' });
      const nav =
        width <= 760 ? page.locator('.career-mobile-nav') : page.locator('aside#career-rail nav');
      await nav.getByRole('button', { name: 'Отклики' }).click();
      const card = page
        .locator('.career-responses-card')
        .filter({ hasText: interviewApplication.vacancy.title });
      await card.getByRole('button', { name: 'Подготовиться' }).click();
      await page
        .getByRole('dialog', { name: /Интервью/u })
        .getByRole('button', { name: 'Начать мок-интервью' })
        .click();
      await expect(page.locator('.career-mock-source-panel')).toContainText('18 всего');
      await checkAndCapture(page, `${width}-many-stories`, true);
    } finally {
      await context.close();
    }
  }
});
