import { expect, test, type Page, type Route } from '@playwright/test';
import { createMockInterviewSimulatorFixture } from './fixtures/mockInterviewSimulator';

/**
 * B511 G3 #6, #9 (макеты 5 и 14): на вкладках «Подготовка», «Хочу», «Офферы» консультант
 * предлагает один шаг по данным вкладки; у тренажёра на 1440 колонки консультанта нет.
 */

type RecordValue = Record<string, unknown>;

const candidate = {
  username: 'b511.candidate',
  email: 'b511@example.com',
  displayName: 'Кандидат B511',
  role: 'candidate' as const,
  isTest: false,
  candidateId: 'candidate-b511',
};

const account = {
  username: candidate.username,
  email: candidate.email,
  displayName: candidate.displayName,
  profile: { headline: 'VP Engineering', location: 'Москва', workMode: 'hybrid' as const },
  sessions: [],
};

const snapshot = {
  candidate: { id: candidate.candidateId, dataClass: 'synthetic', locale: 'ru-RU' },
  messages: [],
  memory: [],
  turns: [],
  dossier: {
    sections: [],
    confirmedCount: 0,
    proposedCount: 0,
    readiness: { complete: true, unresolvedQuestions: 0, checks: [] },
  },
  documents: [],
  assessments: [],
  germanyMarket: null,
  vacancySubscriptions: [],
};

function application(id: string, stage: string, company: string, patch: RecordValue = {}) {
  return {
    id,
    candidateId: candidate.candidateId,
    clusterId: null,
    stage,
    closedReason: null,
    archiveReason: null,
    archivePreviousStage: null,
    processProfile: 'standard',
    vacancy: {
      id: `vacancy-${id}`,
      title: 'VP Engineering',
      company,
      companyHidden: false,
      source: 'hh.ru',
      url: null,
      location: 'Москва',
    },
    notes: null,
    followUpDueAt: null,
    stageChangedAt: '2026-10-01T10:00:00.000Z',
    version: 1,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    followUp: null,
    whoseTurn: 'candidate',
    materials: { coverLetter: true, resume: true },
    nearestInterview: null,
    archiveStaleDays: 30,
    deliveryReceipt: null,
    offer: null,
    ...patch,
  };
}

function offer(id: string, company: string, baseSalary: number, respondBy: string | null) {
  return application(id, 'offer', company, {
    offer: {
      applicationId: id,
      terms: { baseSalary, salaryPeriod: 'month', currency: 'RUB' },
      respondBy,
      createdAt: '2026-10-10T10:00:00.000Z',
      updatedAt: '2026-10-10T10:00:00.000Z',
    },
  });
}

const FILLED = {
  applications: [
    application('app-arka', 'interview', 'Арка Холдинг', {
      nearestInterview: {
        id: 'interview-arka',
        scheduledAt: '2026-10-20T11:00:00.000Z',
        prepStatus: 'none',
        round: 1,
      },
    }),
    offer('offer-vektor', 'Вектор Банк', 450000, '2026-10-25T00:00:00.000Z'),
    offer('offer-sfera', 'Сфера Платежи', 480000, null),
  ],
  companies: [
    {
      key: 'nordline',
      name: 'Нордлайн Финтех',
      location: 'Москва',
      industry: 'Финтех',
      vacancyCount: 7,
      contactsCount: 0,
      contactsImportedAt: null,
      want: true,
      wantStage: 'want',
      hasNewVacancies: true,
      nextStep: null,
      hasRecruiter: false,
      recruiterSearchStatus: 'idle',
      sources: [],
      vacancies: [],
      recruiters: [],
    },
  ],
  stories: 0,
};

const EMPTY = { applications: [], companies: [], stories: 0 };

type Fixture = typeof FILLED | typeof EMPTY;

async function fulfill(route: Route, data: unknown, meta?: unknown) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(meta ? { data, meta } : { data }),
  });
}

function wantPage(fixture: Fixture) {
  const items = fixture.companies;
  return {
    items,
    total: items.length,
    offset: 0,
    limit: 20,
    counts: { all: items.length, new: 0, want: items.length, path: 0, waiting: 0 },
    industries: [...new Set(items.map((company) => company.industry))],
  };
}

async function handleApplications(route: Route, fixture: Fixture) {
  const url = new URL(route.request().url());
  const stages = url.searchParams.getAll('stage');
  const items = fixture.applications.filter(
    (item) => !stages.length || stages.includes(item.stage),
  );
  const stageCounts = fixture.applications.reduce<Record<string, number>>(
    (counts, item) => ({ ...counts, [item.stage]: (counts[item.stage] ?? 0) + 1 }),
    {},
  );
  await fulfill(route, items, {
    total: items.length,
    offset: 0,
    limit: 100,
    nextOffset: null,
    stageCounts,
  });
}

async function installMocks(page: Page, fixture: Fixture) {
  await page.clock.setFixedTime(new Date('2026-10-15T09:00:00.000Z'));
  const interviewFixture = createMockInterviewSimulatorFixture();
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/auth/me') return fulfill(route, candidate);
    if (path === '/api/v1/candidate/me') return fulfill(route, snapshot);
    if (path === '/api/v1/account') return fulfill(route, account);
    if (path === '/api/v1/candidate/connections') return fulfill(route, []);
    if (path === '/api/v1/candidate/workspace') return fulfill(route, null);
    if (path === '/api/v1/candidate/me/messages') {
      return fulfill(route, [], { nextOffset: null });
    }
    if (path === '/api/v1/candidate/star-stories' && request.method() === 'GET') {
      return fulfill(route, { facts: [], stories: [] });
    }
    if (path === '/api/v1/candidate/applications' && request.method() === 'GET') {
      return handleApplications(route, fixture);
    }
    if (path === '/api/v1/candidate/companies/wants' && request.method() === 'GET') {
      return fulfill(route, wantPage(fixture));
    }
    if (path.startsWith('/api/v1/candidate/interview-sessions')) {
      const response = interviewFixture.handle(
        path,
        request.method(),
        request.method() === 'POST' ? (request.postDataJSON() as RecordValue) : {},
      );
      if (response && !('error' in response)) {
        return route.fulfill({ status: response.status ?? 200, json: { data: response.data } });
      }
    }
    return fulfill(route, null);
  });
}

async function seedWorkspace(page: Page) {
  await page.addInitScript((candidateId) => {
    window.localStorage.setItem(
      'candidate-workspace',
      JSON.stringify({
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
          evidenceItems: [
            {
              id: 'evidence-1',
              kind: 'result',
              sourceExcerpt: 'Сократил время релиза с 14 до 3 дней',
              statement: 'Сократил время релиза с 14 до 3 дней',
              status: 'confirmed',
              userEdited: false,
            },
          ],
          questions: [],
          roleHypotheses: [
            {
              id: 'role-vp-engineering',
              title: 'VP Engineering',
              fitState: 'plausible',
              basis: 'Опыт управления платформенной разработкой',
              evidenceIds: ['evidence-1'],
              gaps: [],
            },
          ],
        },
      }),
    );
    window.localStorage.setItem('candidate-workspace-owner', candidateId);
  }, candidate.candidateId);
}

async function openTab(page: Page, tab: RegExp) {
  await page
    .getByRole('navigation', { name: 'Разделы откликов' })
    .getByRole('tab', { name: tab })
    .click();
}

async function openConsultant(page: Page) {
  const strip = page.getByRole('button', { name: /^Развернуть консультанта/u });
  if (await strip.isVisible()) await strip.click();
  return page.locator('.career-expert-panel');
}

async function openResponses(page: Page, fixture: Fixture) {
  await installMocks(page, fixture);
  await seedWorkspace(page);
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await page.locator('button[aria-label="Отклики"]:visible').first().click();
  await expect(page.getByRole('navigation', { name: 'Разделы откликов' })).toBeVisible();
  return openConsultant(page);
}

test.describe('B511 consultant suggestion per «Отклики» tab', () => {
  test.beforeEach(({ page }) => {
    test.skip(page.viewportSize()?.width === 390, 'колонка консультанта — 1440');
  });

  test('с данными: мок-интервью, новые вакансии компании, сравнение офферов', async ({
    page,
  }, testInfo) => {
    const panel = await openResponses(page, FILLED);
    const cases = [
      [/^Подготовка/u, 'prep', 'Мок-интервью по Арка Холдинг', 'Начать'],
      [/^Хочу/u, 'want', 'Новые вакансии в Нордлайн Финтех', 'Найти путь'],
      [/^Офферы/u, 'offers', 'Сравнить 2 оффера', 'Сравнить'],
    ] as const;
    for (const [tab, file, title, accept] of cases) {
      await openTab(page, tab);
      const card = panel.getByRole('region', { name: title });
      await expect(card).toBeVisible();
      await expect(card.getByRole('button', { name: accept })).toBeVisible();
      await expect(card.getByRole('button', { name: 'Не сейчас' })).toBeVisible();
      await expect(panel.getByRole('group', { name: 'Темы для начала' })).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`b511-1440-${file}.png`) });
    }
    await panel.getByRole('button', { name: 'Сравнить', exact: true }).click();
    await expect(page.locator('.career-offer-matrix-company').first()).toBeVisible();
  });

  test('без данных: STAR-история, добавить компании, что спросить о total comp', async ({
    page,
  }, testInfo) => {
    const panel = await openResponses(page, EMPTY);
    const cases = [
      [/^Подготовка/u, 'prep', 'STAR-историй пока нет', 'Добавить историю'],
      [/^Хочу/u, 'want', 'В «Хочу» пока нет компаний', 'Добавить'],
      [/^Офферы/u, 'offers', 'Что спросить о total comp', 'Добавить оффер'],
    ] as const;
    for (const [tab, file, title, accept] of cases) {
      await openTab(page, tab);
      const card = panel.getByRole('region', { name: title });
      await expect(card).toBeVisible();
      await expect(card.getByRole('button', { name: accept })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`b511-1440-${file}-empty.png`) });
    }
    await panel.getByRole('button', { name: 'Добавить оффер' }).click();
    await expect(
      page.locator('.career-offers-panel form, .career-offers-panel [role="form"]').first(),
    ).toBeVisible();
  });

  test('тренажёр: колонки консультанта нет, значок в шапке кладёт её поверх', async ({
    page,
  }, testInfo) => {
    const panel = await openResponses(page, FILLED);
    await openTab(page, /^Подготовка/u);
    await panel.getByRole('button', { name: 'Начать', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Мок-интервью' })).toBeVisible();
    await expect(panel).toBeHidden();
    await page.waitForTimeout(400);
    await page.screenshot({ path: testInfo.outputPath('b511-1440-trainer.png') });
    await page.getByRole('button', { name: 'Открыть консультанта' }).click();
    await expect(panel).toBeVisible();
    await expect(page.getByRole('button', { name: 'Открыть консультанта' })).toHaveCount(0);
  });
});
