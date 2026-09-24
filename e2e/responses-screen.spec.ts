import { expect, test, type Page } from '@playwright/test';

/**
 * B251 S3 — экран «Отклики» (канбан пайплайна из макета
 * docs/v1-release/tasks/work/B248/responses.html). Проверяет, что доска
 * подключена (а не редирект), колонки и счётчики совпадают с макетом и
 * экран не переполняет вьюпорт ни на 1440, ни на 390.
 */

const CANDIDATE = {
  username: 'responses.candidate',
  email: 'responses.candidate@example.com',
  displayName: 'Кандидат Откликов',
  role: 'candidate' as const,
  isTest: false,
  candidateId: 'candidate-b251',
};

const ACCOUNT = {
  username: CANDIDATE.username,
  email: CANDIDATE.email,
  displayName: CANDIDATE.displayName,
  profile: {
    headline: 'Enterprise Architect',
    location: 'Дубай',
    workMode: 'hybrid' as const,
    updatedAt: '2026-09-01T12:00:00.000Z',
  },
  sessions: [],
};

const SNAPSHOT = {
  candidate: {
    id: CANDIDATE.candidateId,
    dataClass: 'synthetic',
    locale: 'ru-RU',
    createdAt: '2026-09-01T12:00:00.000Z',
  },
  messages: [],
  memory: [],
  turns: [],
  dossier: {
    sections: [],
    confirmedCount: 3,
    proposedCount: 0,
    readiness: { complete: true, unresolvedQuestions: 0, checks: [] },
  },
  documents: [],
  assessments: [],
  germanyMarket: null,
  vacancySubscriptions: [],
};

function application(overrides: Record<string, unknown>) {
  return {
    id: overrides.id,
    candidateId: CANDIDATE.candidateId,
    clusterId: overrides.clusterId ?? null,
    stage: 'applied',
    closedReason: null,
    processProfile: 'standard',
    vacancy: null,
    notes: null,
    followUpDueAt: null,
    stageChangedAt: '2026-09-20T10:00:00.000Z',
    version: 1,
    createdAt: '2026-09-15T10:00:00.000Z',
    updatedAt: '2026-09-20T10:00:00.000Z',
    followUp: null,
    whoseTurn: 'company',
    materials: { coverLetter: true, resume: true },
    nearestInterview: null,
    ...overrides,
  };
}

const APPLICATIONS = [
  application({
    id: 'a-1',
    stage: 'saved',
    vacancy: {
      title: 'Cloud & Infra Solution Architect',
      company: 'Sonsoft Inc',
      url: 'https://hh.ru/vacancy/1',
      source: 'hh',
    },
    whoseTurn: 'candidate',
    materials: { coverLetter: false, resume: false },
  }),
  application({
    id: 'a-2',
    stage: 'saved',
    vacancy: {
      title: 'Platform Architect',
      company: 'Nordwind',
      url: 'https://hh.ru/vacancy/2',
      source: 'hh',
    },
    whoseTurn: 'candidate',
    materials: { coverLetter: false, resume: false },
  }),
  application({
    id: 'a-3',
    stage: 'applied',
    vacancy: {
      title: 'Enterprise Architect, Senior Advisor',
      company: 'Peraton',
      url: 'https://hh.ru/vacancy/3',
      source: 'hh',
    },
    whoseTurn: 'candidate',
    followUp: {
      dueAt: '2026-09-24T00:00:00.000Z',
      urgency: 'due',
      source: 'auto',
      businessDaysSinceContact: 6,
    },
  }),
  application({
    id: 'a-4',
    stage: 'applied',
    vacancy: {
      title: 'Business Information Architect',
      company: 'Genetec',
      url: 'https://hh.ru/vacancy/4',
      source: 'hh',
    },
    whoseTurn: 'company',
  }),
  application({
    id: 'a-5',
    stage: 'applied',
    vacancy: {
      title: 'VP Technology, executive search',
      company: '',
      companyHidden: true,
      url: 'https://hh.ru/vacancy/5',
      source: 'recruiter',
    },
    whoseTurn: 'company',
  }),
  application({
    id: 'a-6',
    stage: 'responded',
    vacancy: {
      title: 'Enterprise Architect Director',
      company: 'HRTx, Inc.',
      url: 'https://hh.ru/vacancy/6',
      source: 'hh',
    },
    whoseTurn: 'candidate',
  }),
  application({
    id: 'a-7',
    stage: 'interview',
    vacancy: {
      title: 'Enterprise Architect Director — раунд 2',
      company: 'HRTx, Inc.',
      url: 'https://hh.ru/vacancy/6',
      source: 'hh',
    },
    whoseTurn: 'candidate',
    nearestInterview: {
      id: 'iv-1',
      scheduledAt: '2026-09-26T14:00:00.000Z',
      prepStatus: 'not_started',
    },
  }),
  application({
    id: 'a-8',
    stage: 'rejected',
    closedReason: null,
    vacancy: {
      title: 'Consultant',
      company: 'Pyrovio',
      url: 'https://hh.ru/vacancy/8',
      source: 'hh',
    },
    whoseTurn: null,
  }),
  application({
    id: 'a-9',
    stage: 'archived',
    closedReason: null,
    vacancy: {
      title: 'Aotearoa Board Chair',
      company: 'Orange Sky Australia',
      url: 'https://hh.ru/vacancy/9',
      source: 'hh',
    },
    whoseTurn: null,
  }),
];

const CONFIRMED_EVIDENCE_ITEMS = [
  {
    id: 'evidence-1',
    kind: 'result' as const,
    sourceExcerpt: 'Сократил время закрытия вакансий на 30%',
    statement: 'Сократил время закрытия вакансий на 30%',
    status: 'confirmed' as const,
    userEdited: false,
  },
  {
    id: 'evidence-2',
    kind: 'scope' as const,
    sourceExcerpt: 'Руководил командой архитекторов из 12 человек',
    statement: 'Руководил командой архитекторов из 12 человек',
    status: 'confirmed' as const,
    userEdited: false,
  },
  {
    id: 'evidence-3',
    kind: 'scope' as const,
    sourceExcerpt: 'Отвечал за архитектуру платформы в 3 регионах',
    statement: 'Отвечал за архитектуру платформы в 3 регионах',
    status: 'confirmed' as const,
    userEdited: false,
  },
];

/** Diagnostics must be confirmed (B250) before the rail unlocks «Отклики». */
async function seedWorkspace(page: Page): Promise<void> {
  await page.addInitScript(
    ({ storageKey, ownerKey, candidateId, workspace }) => {
      window.localStorage.setItem(storageKey, JSON.stringify(workspace));
      window.localStorage.setItem(ownerKey, candidateId);
    },
    {
      storageKey: 'candidate-workspace',
      ownerKey: 'candidate-workspace-owner',
      candidateId: CANDIDATE.candidateId,
      workspace: {
        version: 7,
        createdAt: '2026-09-01T12:00:00.000Z',
        updatedAt: '2026-09-01T12:00:00.000Z',
        resumeText:
          'Enterprise Architect with 15+ years scaling platform and operations organisations.',
        resumeSource: 'text',
        targetDirection: 'Enterprise Architect',
        regions: ['mena', 'eu'],
        currentSituation: 'Ищу роль Enterprise Architect.',
        constraints: 'Hybrid',
        urgency: 'active',
        outcomes: [],
        analysis: {
          evidenceMethodVersion: 'evidence-local-v1',
          roleMethodVersion: 'role-hypotheses-local-v1',
          evidenceItems: CONFIRMED_EVIDENCE_ITEMS,
          questions: [],
          roleHypotheses: [
            {
              id: 'role-enterprise-architect',
              title: 'Enterprise Architect',
              fitState: 'plausible',
              basis: 'Опыт архитектуры платформы и управления командой',
              evidenceIds: ['evidence-1', 'evidence-2', 'evidence-3'],
              gaps: [],
            },
          ],
        },
      },
    },
  );
}

async function stubSession(page: Page): Promise<void> {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/v1/auth/me') return route.fulfill({ json: { data: CANDIDATE } });
    if (pathname === '/api/v1/candidate/me') return route.fulfill({ json: { data: SNAPSHOT } });
    if (pathname === '/api/v1/account') return route.fulfill({ json: { data: ACCOUNT } });
    if (pathname === '/api/v1/candidate/connections') return route.fulfill({ json: { data: [] } });
    if (pathname === '/api/v1/candidate/workspace') return route.fulfill({ json: { data: null } });
    if (pathname === '/api/v1/candidate/applications') {
      return route.fulfill({ json: { data: APPLICATIONS } });
    }
    return route.fulfill({ json: { data: null } });
  });
}

async function openResponses(page: Page): Promise<void> {
  await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);
  await page.locator('button[aria-label="Отклики"]:visible').first().click();
}

test.describe('B251 responses screen', () => {
  test('groups cards into the six mockup columns with matching counts', async ({ page }) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openResponses(page);

    const columns = page.locator('.career-responses-column');
    await expect(columns).toHaveCount(6);

    const columnCount = async (label: string) =>
      page
        .locator('.career-responses-column', {
          has: page.getByRole('heading', { name: label, exact: true }),
        })
        .locator('.career-responses-column-count')
        .innerText();

    await expect.poll(() => columnCount('Хочу')).toBe('2');
    await expect.poll(() => columnCount('Откликнулся')).toBe('3');
    await expect.poll(() => columnCount('Ответ')).toBe('1');
    await expect.poll(() => columnCount('Интервью')).toBe('1');
    await expect.poll(() => columnCount('Оффер')).toBe('0');
    await expect.poll(() => columnCount('Отказ / Архив')).toBe('2');
  });

  test('shows role, company and hidden-company copy on cards', async ({ page }) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openResponses(page);

    const board = page.locator('.career-responses-board');
    await expect(board).toContainText('Enterprise Architect, Senior Advisor');
    await expect(board).toContainText('Peraton');
    await expect(board).toContainText('компания скрыта');
  });

  test('the screen fits 1440 and 390 with no horizontal overflow', async ({ page }, testInfo) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });

    await page.setViewportSize({ width: 1440, height: 900 });
    await openResponses(page);
    await expect(page.locator('.career-responses-board-wrap')).toBeVisible();
    const overflow1440 = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow1440).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: process.env.SHOTS_DIR
        ? `${process.env.SHOTS_DIR}/responses-1440.png`
        : testInfo.outputPath('responses-1440.png'),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    const overflow390 = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow390).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: process.env.SHOTS_DIR
        ? `${process.env.SHOTS_DIR}/responses-390.png`
        : testInfo.outputPath('responses-390.png'),
      fullPage: true,
    });
  });

  test('empty pipeline shows the mockup copy', async ({ page }) => {
    await seedWorkspace(page);
    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname === '/api/v1/auth/me') return route.fulfill({ json: { data: CANDIDATE } });
      if (pathname === '/api/v1/candidate/me') return route.fulfill({ json: { data: SNAPSHOT } });
      if (pathname === '/api/v1/account') return route.fulfill({ json: { data: ACCOUNT } });
      if (pathname === '/api/v1/candidate/connections')
        return route.fulfill({ json: { data: [] } });
      if (pathname === '/api/v1/candidate/workspace')
        return route.fulfill({ json: { data: null } });
      if (pathname === '/api/v1/candidate/applications')
        return route.fulfill({ json: { data: [] } });
      return route.fulfill({ json: { data: null } });
    });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openResponses(page);

    await expect(page.locator('.career-responses-empty')).toContainText('Пайплайн пуст');
    await expect(page.locator('.career-responses-empty')).toContainText(
      'Пайплайн наполняется из очереди дня',
    );
  });

  test('a load error shows the offline message and a retry action', async ({ page }) => {
    await seedWorkspace(page);
    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname === '/api/v1/auth/me') return route.fulfill({ json: { data: CANDIDATE } });
      if (pathname === '/api/v1/candidate/me') return route.fulfill({ json: { data: SNAPSHOT } });
      if (pathname === '/api/v1/account') return route.fulfill({ json: { data: ACCOUNT } });
      if (pathname === '/api/v1/candidate/connections')
        return route.fulfill({ json: { data: [] } });
      if (pathname === '/api/v1/candidate/workspace')
        return route.fulfill({ json: { data: null } });
      if (pathname === '/api/v1/candidate/applications')
        return route.fulfill({ status: 500, json: { error: 'boom' } });
      return route.fulfill({ json: { data: null } });
    });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);
    await page.locator('button[aria-label="Отклики"]:visible').first().click();
    await expect(page.locator('.career-expert-error')).toBeVisible();
    await expect(page.locator('.career-expert-error button')).toContainText('Повторить');
  });
});
