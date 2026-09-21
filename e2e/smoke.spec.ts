import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/auth/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: null }),
    });
  });
});

test('public landing page is ready, indexed and free of critical accessibility violations', async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console:${message.text()}`);
  });
  page.on('pageerror', (error) => browserErrors.push(`page:${error.message}`));
  page.on('requestfailed', (request) => {
    browserErrors.push(`request:${new URL(request.url()).pathname}`);
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#root')).not.toHaveAttribute('aria-busy');
  await expect(page.getByRole('heading', { name: 'Ваш поиск работы под контролем' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Собрать профиль из резюме' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Войти' }).first()).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  const accessibility = await new AxeBuilder({ page }).analyze();
  const criticalViolations = accessibility.violations.filter(
    (violation) => violation.impact === 'critical',
  );
  expect(criticalViolations).toEqual([]);
  expect(browserErrors).toEqual([]);
});

test('built career workspace is ready, operable and free of critical accessibility violations', async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console:${message.text()}`);
  });
  page.on('pageerror', (error) => browserErrors.push(`page:${error.message}`));
  page.on('requestfailed', (request) => {
    browserErrors.push(`request:${new URL(request.url()).pathname}`);
  });

  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  const shell = page.getByTestId('career-shell');
  await expect(shell).toBeVisible();
  await expect(page.locator('#root')).not.toHaveAttribute('aria-busy');
  await expect(page.getByRole('heading', { name: 'С чем разобраться?' })).toBeVisible();
  await expect(page.getByText('Загружаем рабочее пространство')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Хочу найти работу' })).toBeEnabled();

  const accountButton = page.locator('button[aria-label="Открыть аккаунт"]:visible').last();
  await expect(accountButton).toBeEnabled();
  await accountButton.click();
  await expect(page.getByRole('dialog', { name: 'Аккаунт' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Аккаунт' })).toHaveCount(0);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  const accessibility = await new AxeBuilder({ page }).analyze();
  const criticalViolations = accessibility.violations.filter(
    (violation) => violation.impact === 'critical',
  );
  expect(criticalViolations).toEqual([]);
  expect(browserErrors).toEqual([]);
});

test('candidate confirms one saved command and sees an honest queued state', async ({
  page,
}, testInfo) => {
  await page.unroute('**/api/v1/auth/**');
  const command = {
    commandId: '33333333-3333-4333-8333-333333333333',
    capability: 'application.submit',
    status: 'awaiting_approval',
    proposal: actionProposal,
    provenance: {
      strategyDecisionId: '11111111-1111-4111-8111-111111111111',
      evidenceRefs: ['message-1'],
      modelInvocationIds: ['response-1'],
    },
    execution: null,
  };
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/v1/auth/me') {
      return route.fulfill({ json: { data: testUser } });
    }
    if (pathname === '/api/v1/candidate/me') {
      return route.fulfill({
        json: {
          data: candidateSnapshot,
          // Снимок приходит частями — маршрут не доносит его целиком (INC-030).
          meta: {
            memory: { total: candidateSnapshot.memory.length, nextOffset: null },
            messages: { total: candidateSnapshot.messages.length, nextOffset: null },
            turns: { total: candidateSnapshot.turns.length, nextOffset: null },
          },
        },
      });
    }
    if (pathname === '/api/v1/candidate/me/messages') {
      return route.fulfill({
        json: {
          data: candidateSnapshot.messages,
          meta: { total: candidateSnapshot.messages.length, offset: 0, nextOffset: null },
        },
      });
    }
    // The strategist is opened from the cabinet, which exists only once the
    // diagnostic has produced a career picture. Before B169 a contextless
    // «Эксперт» button in the top bar opened it from anywhere, including from
    // inside an unfinished wizard.
    if (pathname === '/api/v1/candidate/workspace' && request.method() === 'GET') {
      return route.fulfill({ json: { data: candidateWorkspace } });
    }
    if (pathname === '/api/v1/candidate/career-commands' && request.method() === 'GET') {
      return route.fulfill({ json: { data: [command] } });
    }
    if (pathname.endsWith('/approvals') && request.method() === 'POST') {
      return route.fulfill({
        json: { data: { ...command, status: 'queued' } },
      });
    }
    return route.fulfill({ status: 404, json: { error: { code: 'not_mocked' } } });
  });

  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  // B169 §8 — the strategist is opened from the place that has a reason to
  // open it. The contextless «Эксперт» button in the top bar is gone; на
  // «Главной» вход к нему держит карточка консультанта (B179).
  // Вход к консультанту свёрнут под профилем (B233): сначала раскрыть.
  const consultantFold = page.locator('.career-home-fold', { hasText: 'Карьерный консультант' });
  await consultantFold.locator('summary').click();
  await page.getByRole('button', { name: /(Начать|Продолжить) разговор/u }).click();
  const dialog = page.getByRole('dialog', { name: 'Карьерный эксперт' });
  await expect(dialog.getByText('Ничего не отправлено')).toBeVisible();

  const approvalRequest = page.waitForRequest(
    (request) =>
      request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/approvals'),
  );
  await dialog.getByRole('button', { name: 'Подтвердить отправку' }).click();
  await approvalRequest;

  await expect(dialog.getByText('Подтверждено', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Ожидает безопасного исполнителя.')).toBeVisible();
  await expect(dialog.getByText(/Выполнено/)).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('command-status.png'),
    fullPage: true,
  });

  const accessibility = await new AxeBuilder({ page }).include('.career-expert-panel').analyze();
  expect(accessibility.violations.filter((violation) => violation.impact === 'critical')).toEqual(
    [],
  );
});

const testUser = {
  username: 'qa-candidate',
  role: 'candidate',
  isTest: true,
  candidateId: 'candidate-1',
};

const actionProposal = {
  kind: 'application.submit',
  objective: 'Отправить проверенный отклик',
  evidenceRefs: ['message-1'],
  acceptanceCriteria: ['Получен receipt'],
  expectedSignal: 'Отклик принят площадкой',
  measureAfter: '2026-08-19',
  risk: 'external_side_effect',
};

const coachResult = {
  message: 'Отклик подготовлен только как предложение.',
  phase: 'targeting',
  nextQuestion: null,
  completeness: { known: [], unknown: [] },
  safety: { needsHuman: false, reason: null },
  careerTrack: null,
  actionProposals: [actionProposal],
};

const candidateWorkspace = {
  careerGoal: 'find-job',
  resumeText: 'Руководитель продукта с опытом в финтехе и маркетплейсах.',
  resumeSource: 'text',
  targetDirection: 'Руководитель продукта',
  market: 'ru',
  currentSituation: 'Ищу новую роль и хочу проверить позиционирование.',
  constraints: 'Готов к гибриду',
  urgency: 'active',
} as const;

const candidateSnapshot = {
  candidate: {
    id: 'candidate-1',
    dataClass: 'synthetic',
    locale: 'ru-RU',
    createdAt: '2026-08-12T18:00:00.000Z',
  },
  messages: [
    { id: 'message-1', role: 'user', content: 'Подготовь отклик' },
    { id: 'message-2', role: 'assistant', content: coachResult.message },
  ],
  memory: [],
  turns: [
    {
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
      phase: 'targeting',
      status: 'completed',
      result: coachResult,
      provenance: {
        provider: 'openai',
        model: 'gpt-5.6-sol',
        responseId: 'response-1',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      },
    },
  ],
  dossier: {
    sections: [],
    confirmedCount: 0,
    proposedCount: 0,
    readiness: { complete: false, unresolvedQuestions: 1, checks: [] },
  },
  assessments: [],
  germanyMarket: null,
};
