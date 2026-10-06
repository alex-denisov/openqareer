import { expect, test, type Page } from '@playwright/test';

/**
 * C47 (B251 F5) — the chain a candidate actually walks: vacancy card →
 * «Откликнуться» → «Отклики» with the card at `applied` → stage moved to
 * «Интервью» with a date → «Сегодня» shows «Интервью через N дней» and
 * «Подготовиться» → the interview prep material opens. Also covers the
 * empty tracker's honest step back to «Вакансии». Stubs follow
 * `today-screen.spec.ts` / `vacancies-screen.spec.ts` / `responses-screen.spec.ts`.
 */

const CANDIDATE = {
  username: 'chain.candidate',
  email: 'chain.candidate@example.com',
  displayName: 'Кандидат Цепочки',
  role: 'candidate' as const,
  isTest: false,
  candidateId: 'candidate-c47',
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

const CAMPAIGN = {
  roles: { value: ['Enterprise Architect'], origin: 'profile' },
  regions: { value: ['Канада'], origin: 'profile' },
  remoteOnly: false,
  autoRoles: [{ id: 'architect.primary', title: 'Enterprise Architect', kind: 'primary' as const }],
  roleHypotheses: [{ role: 'Enterprise Architect', vacancyCount: 12, isHypothesis: false }],
};

const CLUSTER = {
  id: 'c-1',
  canonicalTitle: 'Enterprise Architect',
  canonicalCompany: 'Genetec',
  canonicalLocation: 'Канада',
  isRemote: true,
  salary: { from: 190000, to: 240000, currency: 'USD', gross: true },
  descriptionSummary: '',
  skills: ['Operations'],
  primaryUrl: 'https://example.com/vacancy',
  sources: [
    {
      sourceType: 'hh',
      sourceId: 'c-1',
      sourceName: 'hh.ru',
      sourceUrl: 'https://hh.ru/vacancy',
      observedAt: '2026-09-20T08:00:00.000Z',
    },
  ],
  firstObservedAt: '2026-09-20T08:00:00.000Z',
  lastSeenAt: '2026-09-23T08:00:00.000Z',
  status: 'active',
  vacanciesCount: 1,
};

const MATCHED_ITEMS = [
  {
    cluster: CLUSTER,
    explanation: {
      clusterId: 'c-1',
      roleMatch: 'target',
      levelMatch: 'match',
      outsideGeography: false,
      matchingPoints: ['Опыт архитектуры платформы'],
      missingPoints: [],
      summary: '',
      calculatedAt: '2026-09-24T08:00:00.000Z',
    },
  },
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

interface ApplicationRecord {
  id: string;
  clusterId?: string | null;
  stage: string;
  version: number;
  vacancy: { title: string; company: string; companyHidden: boolean; url: string; source: string };
  nearestInterview: { id: string; scheduledAt: string; prepStatus: string; round: number } | null;
}

function applicationView(record: ApplicationRecord) {
  return {
    id: record.id,
    candidateId: CANDIDATE.candidateId,
    clusterId: record.clusterId === undefined ? 'c-1' : record.clusterId,
    stage: record.stage,
    closedReason: null,
    processProfile: 'standard',
    vacancy: record.vacancy,
    notes: null,
    followUpDueAt: null,
    stageChangedAt: '2026-09-24T10:00:00.000Z',
    version: record.version,
    createdAt: '2026-09-24T10:00:00.000Z',
    updatedAt: '2026-09-24T10:00:00.000Z',
    followUp: null,
    whoseTurn: 'company',
    materials: { coverLetter: false, resume: false },
    nearestInterview: record.nearestInterview,
  };
}

interface VacancyApplicationRecord {
  clusterId: string;
  status: string;
  vacancy: unknown;
  openedAt: string | null;
  appliedAt: string | null;
  confirmedBy: 'candidate' | null;
}

interface StubOptions {
  readonly initialVacancyApplications?: VacancyApplicationRecord[];
  readonly failAppliedWrite?: boolean;
  readonly failInterviewCreation?: boolean;
}

/** One route table shared by both tests: an in-memory tracker that mutates
 * as the candidate applies, moves the stage and schedules the interview —
 * the chain has no meaning against a frozen fixture. */
function stubSession(
  page: Page,
  initialApplications: ApplicationRecord[] = [],
  options: StubOptions = {},
): Promise<void> {
  const applications = initialApplications;
  const vacancyApplications = [...(options.initialVacancyApplications ?? [])];
  return page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/v1/auth/me') return route.fulfill({ json: { data: CANDIDATE } });
    if (pathname === '/api/v1/candidate/me') return route.fulfill({ json: { data: SNAPSHOT } });
    if (pathname === '/api/v1/account') return route.fulfill({ json: { data: ACCOUNT } });
    if (pathname === '/api/v1/candidate/connections') return route.fulfill({ json: { data: [] } });
    if (pathname === '/api/v1/candidate/workspace') return route.fulfill({ json: { data: null } });
    if (pathname === '/api/v1/candidate/vacancy-sources') {
      return route.fulfill({
        json: { data: [{ id: 'hh', name: 'hh.ru', health: { status: 'healthy' } }] },
      });
    }
    if (pathname === '/api/v1/candidate/matched-vacancies') {
      return route.fulfill({
        json: {
          data: MATCHED_ITEMS,
          meta: { total: 1, nextOffset: null, campaign: CAMPAIGN, candidateLevel: 'VP / C-level' },
        },
      });
    }
    if (request.method() === 'POST' && pathname === '/api/v1/candidate/vacancy-applications') {
      const body = request.postDataJSON() as {
        clusterId: string;
        status: string;
        vacancy: unknown;
      };
      if (options.failAppliedWrite && body.status === 'applied') {
        return route.fulfill({ status: 500, json: { error: 'write_failed' } });
      }
      const appliedAt = body.status === 'applied' ? '2026-09-27T09:00:00.000Z' : null;
      const stored: VacancyApplicationRecord = {
        ...body,
        openedAt: '2026-09-27T09:00:00.000Z',
        appliedAt,
        confirmedBy: appliedAt ? 'candidate' : null,
      };
      const existing = vacancyApplications.find(
        (application) => application.clusterId === body.clusterId,
      );
      if (existing) Object.assign(existing, stored);
      else vacancyApplications.push(stored);
      if (body.status === 'applied') {
        const tracked = applications.find(
          (application) => application.clusterId === body.clusterId,
        );
        if (tracked) tracked.stage = 'applied';
        else {
          applications.push({
            id: `app-${applications.length + 1}`,
            clusterId: body.clusterId,
            stage: 'applied',
            version: 1,
            vacancy: {
              title: CLUSTER.canonicalTitle,
              company: CLUSTER.canonicalCompany,
              companyHidden: false,
              url: CLUSTER.primaryUrl,
              source: 'hh',
            },
            nearestInterview: null,
          });
        }
      }
      return route.fulfill({
        json: {
          data: {
            clusterId: body.clusterId,
            status: body.status,
            vacancy: body.vacancy,
            openedAt: stored.openedAt,
            appliedAt: stored.appliedAt,
            confirmedBy: stored.confirmedBy,
          },
        },
      });
    }
    if (pathname === '/api/v1/candidate/vacancy-applications') {
      return route.fulfill({ json: { data: vacancyApplications } });
    }
    if (request.method() === 'POST' && pathname === '/api/v1/candidate/applications') {
      const body = request.postDataJSON() as {
        clusterId?: string;
        stage: string;
        manualVacancy?: {
          title: string;
          company?: string;
          companyHidden?: boolean;
          url?: string;
          source: string;
        };
      };
      const existing = applications.find(
        (item) => body.clusterId !== undefined && item.clusterId === body.clusterId,
      );
      if (existing) return route.fulfill({ json: { data: applicationView(existing) } });
      const created: ApplicationRecord = {
        id: `app-${applications.length + 1}`,
        clusterId: body.clusterId ?? null,
        stage: body.stage,
        version: 1,
        vacancy: {
          title: body.manualVacancy?.title ?? CLUSTER.canonicalTitle,
          company: body.manualVacancy?.company ?? CLUSTER.canonicalCompany,
          companyHidden: body.manualVacancy?.companyHidden ?? false,
          url: body.manualVacancy?.url ?? CLUSTER.primaryUrl,
          source: body.manualVacancy?.source ?? 'hh',
        },
        nearestInterview: null,
      };
      applications.push(created);
      return route.fulfill({ json: { data: applicationView(created) } });
    }
    if (request.method() === 'PATCH' && pathname === '/api/v1/candidate/applications/app-1') {
      const body = request.postDataJSON() as { stage?: string };
      const record = applications.find((item) => item.id === 'app-1')!;
      record.stage = body.stage ?? record.stage;
      record.version += 1;
      return route.fulfill({ json: { data: applicationView(record) } });
    }
    if (request.method() === 'POST' && pathname.endsWith('/interviews')) {
      if (options.failInterviewCreation) {
        return route.fulfill({ status: 500, json: { error: 'interview_write_failed' } });
      }
      const body = request.postDataJSON() as { round: number; scheduledAt: string };
      const applicationId = pathname.split('/').at(-2);
      const record = applications.find((item) => item.id === applicationId)!;
      record.stage = 'interview';
      record.nearestInterview = {
        id: 'iv-1',
        scheduledAt: body.scheduledAt,
        prepStatus: 'not_started',
        round: body.round,
      };
      return route.fulfill({ json: { data: { id: 'iv-1', ...body } } });
    }
    if (pathname === '/api/v1/candidate/applications') {
      return route.fulfill({ json: { data: applications.map(applicationView) } });
    }
    if (pathname === '/api/v1/candidate/today') {
      const withInterview = applications.find((item) => item.nearestInterview);
      return route.fulfill({
        json: {
          data: {
            digest: {
              waitingForYou: 0,
              newVacancies: 0,
              followUpsDueToday: 0,
              followUpsOverdue: 0,
              closedVacancies: 0,
              interviewsAhead: withInterview ? 1 : 0,
              nextInterview: withInterview
                ? {
                    company: withInterview.vacancy.company,
                    title: withInterview.vacancy.title,
                    round: withInterview.nearestInterview!.round,
                    at: withInterview.nearestInterview!.scheduledAt,
                  }
                : null,
              newVacanciesCaption: null,
              followUpCaptions: [],
            },
            queue: withInterview
              ? [
                  {
                    kind: 'interview',
                    applicationId: withInterview.id,
                    title: withInterview.vacancy.title,
                    company: withInterview.vacancy.company,
                    eyebrow: 'Интервью',
                    dueAt: withInterview.nearestInterview!.scheduledAt,
                    fit: null,
                  },
                ]
              : [],
            followUps: [],
            sinceLastVisit: { since: null, items: [] },
            vacanciesPending: false,
          },
        },
      });
    }
    if (request.method() === 'POST' && pathname === '/api/v1/candidate/visits') {
      return route.fulfill({ json: { data: { since: null } } });
    }
    return route.fulfill({ json: { data: null } });
  });
}

async function openVacancies(page: Page): Promise<void> {
  await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);
  await page.locator('button[aria-label="Вакансии"]:visible').first().click();
  await expect(page.locator('.vacancies-screen')).toBeVisible();
}

/** На 1440 первая вакансия уже раскрыта; повторный клик по заголовку её свернёт (B324). */
async function openFirstVacancy(page: Page): Promise<void> {
  const firstItem = page.locator('.vac-list-item').first();
  await expect(firstItem).toBeVisible();
  if (await firstItem.locator('.vacancies-detail-col').isVisible()) return;
  await firstItem.locator('.vac-row').click();
  await expect(firstItem.locator('.vacancies-detail-col')).toBeVisible();
}

async function openResponses(page: Page): Promise<void> {
  await page.locator('button[aria-label="Отклики"]:visible').first().click();
}

async function walkChain(page: Page): Promise<void> {
  await openVacancies(page);
  await openFirstVacancy(page);

  const applyButton = page
    .locator('.vacancies-detail-col')
    .getByRole('button', { name: 'Откликнуться' });
  await applyButton.click();
  // B341: открытие сайта — ещё не отклик; отметка только по подтверждению.
  await expect(page.locator('.vacancies-detail-col')).not.toContainText('Отклик отмечен');
  await page
    .locator('.vacancies-detail-col')
    .getByRole('button', { name: 'Да, отклик отправлен' })
    .click();
  await expect(page.locator('.vacancies-detail-col')).toContainText('Отклик отмечен');
  const goToResponses = page.getByRole('button', { name: 'Перейти в «Отклики»' });
  await expect(goToResponses).toBeVisible();
  await goToResponses.click();

  const board = page.locator('.career-responses-board');
  await expect(board).toBeVisible();
  const card = page.locator('.career-responses-card').filter({ hasText: 'Genetec' });
  await expect(card).toBeVisible();

  await card.getByLabel('Действия с карточкой').click();
  await card.locator('.career-responses-stage-control select').first().selectOption('interview');
  await card.locator('input[type="date"]').fill('2026-09-30');
  await card.getByRole('button', { name: 'Сохранить этап' }).click();

  const prepButton = card.getByRole('button', { name: 'Подготовиться' });
  await expect(prepButton).toBeVisible();
  await prepButton.click();
  await expect(page.getByRole('dialog')).toContainText('Genetec');
  await page.getByRole('button', { name: 'Закрыть модальное окно' }).click();

  await page.locator('button[aria-label="Сегодня"]:visible').first().click();
  await expect(page.locator('.career-today')).toBeVisible();
  const todayPrep = page.getByRole('button', { name: 'Подготовиться' });
  await expect(todayPrep).toBeVisible();
  await todayPrep.click();
  await expect(page.getByRole('dialog')).toContainText('Genetec');
  await page.getByRole('button', { name: 'Закрыть модальное окно' }).click();
}

async function walkManualAppliedChain(page: Page): Promise<void> {
  const viewport = page.viewportSize()?.width ?? 0;
  await openVacancies(page);
  await openFirstVacancy(page);
  await page.getByRole('button', { name: 'Я уже откликнулся' }).click();
  await expect(page.locator('.vacancies-detail-col')).toContainText('Отклик отмечен');

  await page.getByRole('button', { name: 'Назначили интервью' }).click();
  await page.getByLabel('Дата и время интервью').fill('2026-09-30T13:45');
  await page.screenshot({ path: `output/playwright/c70-interview-assignment-${viewport}.png` });
  await page.getByRole('button', { name: 'Сохранить и открыть подготовку' }).click();

  const preparation = page.getByRole('dialog');
  await expect(preparation).toContainText('Genetec');
  await preparation.screenshot({ path: `output/playwright/c70-interview-prep-${viewport}.png` });
}

async function walkExistingAppliedVacancyToPrep(page: Page): Promise<void> {
  await openVacancies(page);
  await openFirstVacancy(page);
  await expect(page.locator('.vacancies-detail-col')).toContainText('Отклик отмечен');
  await page.getByRole('button', { name: 'Назначили интервью' }).click();
  await page.getByLabel('Дата и время интервью').fill('2026-09-30T13:45');
  await page.getByRole('button', { name: 'Сохранить и открыть подготовку' }).click();
  await expect(page.getByRole('dialog')).toContainText('Genetec');
}

test.describe('C47 apply-to-interview chain', () => {
  test('walks vacancy → apply → responses → interview stage → today → prep on 1440', async ({
    page,
  }) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await walkChain(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('walks the same chain on 390 with no horizontal overflow', async ({ page }) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await walkChain(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('the empty tracker points back to «Вакансии» instead of a dead end', async ({ page }) => {
    await stubSession(page, []);
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openResponses(page);

    await expect(page.locator('.career-responses-empty')).toContainText(
      'Откликнитесь на вакансию из подборки',
    );
    await page
      .locator('.career-responses-empty')
      .getByRole('button', { name: 'Перейти к вакансиям' })
      .click();
    await expect(page.locator('.vacancies-screen')).toBeVisible();
  });

  test('marks an external application and opens interview prep directly on 1440', async ({
    page,
  }) => {
    await stubSession(page, [], { failInterviewCreation: false });
    await seedWorkspace(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await walkManualAppliedChain(page);
  });

  test('marks an external application and opens interview prep directly on 390', async ({
    page,
  }) => {
    await stubSession(page, [], { failInterviewCreation: false });
    await seedWorkspace(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await walkManualAppliedChain(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('creates a missing tracker card for an already-applied vacancy', async ({ page }) => {
    await stubSession(page, [], {
      initialVacancyApplications: [
        {
          clusterId: 'c-1',
          status: 'applied',
          vacancy: { title: CLUSTER.canonicalTitle, company: CLUSTER.canonicalCompany },
          openedAt: '2026-09-20T09:00:00.000Z',
          appliedAt: '2026-09-20T09:00:00.000Z',
          confirmedBy: 'candidate',
        },
      ],
    });
    await seedWorkspace(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });

    await walkExistingAppliedVacancyToPrep(page);
  });

  test('keeps the vacancy unapplied when saving the manual confirmation fails', async ({
    page,
  }) => {
    await stubSession(page, [], { failAppliedWrite: true });
    await seedWorkspace(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);
    await openFirstVacancy(page);

    await page.getByRole('button', { name: 'Я уже откликнулся' }).click();

    await expect(page.locator('.vacancies-interview-error')).toContainText('Состояние не изменено');
    await expect(page.locator('.vacancies-detail-col')).not.toContainText('Отклик отмечен');
    await expect(page.getByRole('button', { name: 'Я уже откликнулся' })).toBeVisible();
  });

  test('keeps the applied stage and does not open prep when interview scheduling fails', async ({
    page,
  }) => {
    await stubSession(page, [], {
      initialVacancyApplications: [
        {
          clusterId: 'c-1',
          status: 'applied',
          vacancy: { title: CLUSTER.canonicalTitle, company: CLUSTER.canonicalCompany },
          openedAt: '2026-09-20T09:00:00.000Z',
          appliedAt: '2026-09-20T09:00:00.000Z',
          confirmedBy: 'candidate',
        },
      ],
      failInterviewCreation: true,
    });
    await seedWorkspace(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);
    await openFirstVacancy(page);
    await page.getByRole('button', { name: 'Назначили интервью' }).click();
    await page.getByLabel('Дата и время интервью').fill('2026-09-30T13:45');
    await page.getByRole('button', { name: 'Сохранить и открыть подготовку' }).click();

    await expect(page.locator('.vacancies-interview-error')).toContainText('Этап не изменён');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.vacancies-detail-col')).toContainText('Отклик отмечен');
  });

  test('adds a manual response from the empty tracker', async ({ page }) => {
    await stubSession(page, []);
    await seedWorkspace(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openResponses(page);

    await page.getByRole('button', { name: 'Добавить отклик вручную' }).click();
    const form = page.getByRole('dialog', { name: 'Добавить карточку вручную' });
    await form.getByLabel('Роль').fill('Архитектор платформы');
    await form.getByRole('textbox', { name: 'Компания' }).fill('Genetec');
    await form.getByRole('button', { name: 'Добавить' }).click();

    await expect(page.locator('.career-responses-card')).toContainText('Архитектор платформы');
    await expect(page.locator('.career-responses-card')).toContainText('Genetec');
  });
});
