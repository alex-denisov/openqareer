import type { Page, Route } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';

const DAY = 86_400_000;
const iso = (daysAgo: number): string => new Date(Date.now() - daysAgo * DAY).toISOString();

type Stub = Record<string, unknown> & { id: string; stage: string; version: number };

function application(
  id: string,
  title: string,
  company: string,
  extra: Record<string, unknown>,
): Stub {
  const sent = iso(10);
  return {
    id,
    candidateId: 'candidate-fixture',
    clusterId: `cluster-${id}`,
    stage: 'applied',
    closedReason: null,
    archiveReason: null,
    archivePreviousStage: null,
    processProfile: 'standard',
    vacancy: { title, company, url: 'https://hh.ru/vacancy/1', source: 'hh' },
    notes: null,
    followUpDueAt: null,
    stageChangedAt: sent,
    version: 1,
    createdAt: sent,
    updatedAt: sent,
    appliedAt: sent,
    reachedStages: ['applied'],
    followUp: null,
    whoseTurn: 'company',
    materials: { coverLetter: true, resume: true },
    nearestInterview: null,
    deliveryReceipt: null,
    deliveryReceiptRecordedAt: null,
    interviewScheduledAt: [],
    ...extra,
  };
}

export function responseFixtures(): Stub[] {
  return [
    application('a-draft', 'Head of Engineering', 'Гринкод', {
      stage: 'saved',
      appliedAt: null,
      whoseTurn: 'candidate',
      updatedAt: iso(1),
      // Черновик: письмо ещё не одобрено, к отклику не привязано (B723).
      materials: { coverLetter: false, resume: false },
    }),
    application('a-failed', 'Руководитель платформы', 'Карта Технологии', {
      deliveryReceipt: { kind: 'failure_note', value: 'Не доставлено: нужен вход в hh.ru' },
      deliveryReceiptRecordedAt: iso(1),
      whoseTurn: 'candidate',
    }),
    application('a-interview', 'Руководитель платформы', 'Арка Холдинг', {
      stage: 'interview',
      stageChangedAt: iso(2),
      reachedStages: ['applied', 'responded', 'interview'],
      nearestInterview: { id: 'i1', scheduledAt: iso(-3), prepStatus: 'ready', round: 1 },
      interviewScheduledAt: [iso(-3)],
      deliveryReceipt: { kind: 'auto_reply', value: 'ok' },
      deliveryReceiptRecordedAt: iso(9),
      notes: 'Спросить про размер команды платформы.',
    }),
    application('a-silent', 'Директор по разработке', 'Маркет Софт', {
      followUp: {
        dueAt: iso(2),
        urgency: 'overdue',
        source: 'standard_schedule',
        daysSinceContact: 8,
      },
      whoseTurn: 'candidate',
      vacancy: {
        title: 'Директор по разработке',
        company: 'Маркет Софт',
        url: '',
        source: 'linkedin',
      },
    }),
    application('a-offer', 'Руководитель разработки', 'Вектор Банк', {
      stage: 'offer',
      stageChangedAt: iso(2),
      reachedStages: ['applied', 'responded', 'interview', 'offer'],
      whoseTurn: 'candidate',
      offer: {
        applicationId: 'a-offer',
        terms: {},
        respondBy: iso(-2),
        createdAt: iso(2),
        updatedAt: iso(2),
      },
    }),
    application('a-rejected', 'Руководитель группы бэкенда', 'Сбыт Онлайн', {
      stage: 'rejected',
      stageChangedAt: iso(3),
      reachedStages: ['applied', 'responded'],
      whoseTurn: null,
    }),
    application('a-closed', 'Engineering Manager', 'Ритм Финанс', {
      stage: 'archived',
      archiveReason: 'vacancy_closed',
      stageChangedAt: iso(20),
      appliedAt: iso(35),
      whoseTurn: null,
    }),
  ];
}

function company(
  key: string,
  name: string,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    key,
    name,
    location: null,
    industry: 'Финтех',
    vacancyCount: 0,
    contactsCount: 1,
    contactsImportedAt: null,
    want: true,
    wantStage: 'want',
    hasNewVacancies: false,
    nextStep: null,
    hasRecruiter: false,
    recruiterSearchStatus: 'idle',
    sources: [],
    vacancies: [],
    recruiters: [],
    ...extra,
  };
}

const COMPANIES = [
  company('grinkod', 'Гринкод', { vacancyCount: 1, hasNewVacancies: true }),
  company('lenta', 'Лента Финанс', { vacancyCount: 2, hasNewVacancies: true }),
  company('sever', 'Северный Банк', { wantStage: 'waiting', industry: 'Банки' }),
  company('gorod', 'Город Данных', { wantStage: 'path', industry: 'Аналитика', contactsCount: 0 }),
];

const TEAM_GUESS = {
  requirement: 'Команда от 20 человек',
  quote: 'опыт управления командой от 20 человек',
  profileFact: 'руководил командой из 9 человек',
};

function reviewPayload(
  ready: boolean,
  reason: Record<string, unknown> | null,
  helped: boolean | null,
  resumeFact: boolean,
) {
  const rejection = {
    applicationId: 'a-rejected',
    title: 'Руководитель группы бэкенда',
    company: 'Сбыт Онлайн',
    rejectedAt: iso(3),
    guess: TEAM_GUESS,
    candidateReason: reason,
  };
  const base = { threshold: 20, rejectedCount: 1, rejections: [rejection], helped };
  if (!ready) {
    return {
      ...base,
      state: 'low_data',
      sentCount: 6,
      firstStep: {
        kind: 'update_statuses',
        requirement: null,
        profileFact: null,
        count: 2,
        total: 6,
      },
      recommendations: [],
      checks: {
        since: '2026-10-02T10:00:00.000Z',
        unfinished: { count: 3, total: 6 },
        salaryBelow: { count: 2, total: 6, floor: 500000, currency: 'RUB' },
        late: { count: 4, total: 6 },
      },
    };
  }
  return {
    ...base,
    state: 'ready',
    sentCount: 22,
    firstStep: {
      kind: 'show_in_resume',
      ...TEAM_GUESS,
      quote: undefined,
      count: 2,
      total: 3,
      ...(resumeFact ? { resumeFactId: RESUME_FACT_ID } : {}),
    },
    recommendations: [
      {
        kind: 'match_vacancies',
        requirement: 'Опыт в брокерских системах',
        profileFact: null,
        count: 1,
        total: 3,
      },
    ],
  };
}

/** Факт из беседы и готовый пункт резюме из него (k06). */
const RESUME_FACT_ID = 'fact-team';
export const RESUME_VARIANT = 'Вёл бэкенд: в группе 18 человек.';
export const RESUME_BULLET = 'Руководил группой бэкенда из 18 человек.';

/** Разговор раздела, запись из него и место работы, куда встанет пункт. */
async function mockResumeConversation(page: Page): Promise<void> {
  const said = {
    id: 'u1',
    role: 'user',
    content: 'Команда была 18 человек.',
    createdAt: '2026-11-11T10:00:00.000Z',
  };
  const memory = [
    {
      id: RESUME_FACT_ID,
      kind: 'fact',
      domain: 'outcome',
      statement: 'Сфера Платежи: команда 18 человек',
      confidence: 'candidate-confirmed',
      sourceMessageIds: ['u1'],
      sensitive: false,
      status: 'confirmed',
    },
  ];
  const candidate = {
    id: 'candidate-1',
    dataClass: 'synthetic',
    locale: 'ru-RU',
    createdAt: iso(40),
  };
  await page.route('**/api/v1/candidate/me/messages**', (route) =>
    route.fulfill({ json: { data: [said], meta: { nextOffset: null } } }),
  );
  await page.route('**/api/v1/candidate/me?memoryOffset=*', (route) =>
    route.fulfill({
      json: {
        data: { candidate, messages: [], memory, turns: [] },
        meta: { memory: { nextOffset: null }, turns: { nextOffset: null } },
      },
    }),
  );
  const current = {
    id: 'current',
    stage: 'responses',
    startedAt: said.createdAt,
    closedAt: null,
    messages: [said],
    replies: [],
    analysisPending: false,
  };
  await page.route('**/api/v1/candidate/consultant/current**', (route) =>
    route.fulfill({ json: { data: current } }),
  );
  const entry = {
    id: 'e1',
    chronologyMemoryId: 'm-e1',
    title: 'Руководитель группы',
    employer: 'Сфера Платежи',
    startDate: '2018',
    current: false,
    bulletMemoryIds: [],
  };
  await page.route('**/api/v1/candidate/resume', (route) =>
    route.fulfill({ json: { data: { draft: { candidate: {}, experience: [entry] } } } }),
  );
}

/** Предложение консультанта: запись и отмена попадают в `calls`. */
async function mockFactRewrite(page: Page, calls: string[]): Promise<void> {
  await page.route('**/api/v1/candidate/experience-fact-rewrite**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/apply')) {
      const { only, variantId } = route.request().postDataJSON() as {
        only: string[];
        variantId?: string;
      };
      calls.push(['apply', only.join(','), variantId].filter(Boolean).join(' '));
      const rewrite = { id: 'p1', appliedAt: iso(0), bullets: [], declinedFactIds: [] };
      return route.fulfill({ json: { data: { rewrite } } });
    }
    if (path.endsWith('/variants')) {
      const made = route.request().method() === 'POST';
      if (made) calls.push('variant');
      const variant = { id: 'v1', position: 1, text: RESUME_VARIANT, payload: null };
      const list = { variants: made ? [variant] : [], remaining: made ? 2 : 3 };
      return route.fulfill({ status: made ? 201 : 200, json: { data: list } });
    }
    if (path.endsWith('/revert')) {
      calls.push('revert');
      return route.fulfill({ json: { data: { reverted: true } } });
    }
    const bullets = [{ text: RESUME_BULLET, sourceFactIds: [RESUME_FACT_ID] }];
    const places = [{ experienceId: 'e1', bullets }];
    const proposal = { id: 'p1', places, leftOutFactIds: [], sourceFactIds: [RESUME_FACT_ID] };
    return route.fulfill({ json: { data: { proposal } } });
  });
}

const reviewState: { reason: Record<string, unknown> | null; helped: boolean | null } = {
  reason: null,
  helped: null,
};

/** Заглушки механики разбора отказов (B679). */
async function mockReview(
  route: Route,
  path: string,
  method: string,
  options: ResponsesMockOptions,
  calls: string[],
) {
  const base = '/api/v1/candidate/applications/rejection-review';
  if (path === base && method === 'GET') {
    await route.fulfill({
      json: {
        data: reviewPayload(
          options.reviewReady === true,
          reviewState.reason,
          reviewState.helped,
          options.resumeFact === true,
        ),
      },
    });
    return true;
  }
  if (path === `${base}/feedback` && method === 'PUT') {
    const body = route.request().postDataJSON() as { helped: boolean };
    calls.push(`PUT feedback ${body.helped}`);
    reviewState.helped = body.helped;
    await route.fulfill({ json: { data: body } });
    return true;
  }
  if (path.endsWith('/rejection-reason') && method === 'PUT') {
    const body = route.request().postDataJSON() as { reason: string; note: string | null };
    calls.push(`PUT reason ${body.reason} ${body.note ?? ''}`.trim());
    reviewState.reason = { ...body, recordedAt: new Date().toISOString() };
    await route.fulfill({ json: { data: reviewState.reason } });
    return true;
  }
  return false;
}

export interface ResponsesMockOptions {
  readonly applications?: Stub[];
  readonly companies?: readonly Record<string, unknown>[];
  /** Автоотклики включены и согласия даны. */
  readonly automation?: boolean;
  /** Сколько раз список откликов отвечает ошибкой, прежде чем отдать данные. */
  readonly failList?: number;
  /** Разбор отказов готов (откликов хватает); иначе — «мало данных». */
  readonly reviewReady?: boolean;
  /** Факт рекомендации есть в беседе, но не в резюме: «Поправить резюме». */
  readonly resumeFact?: boolean;
  /** Тариф: на Free автооткликов нет. По умолчанию Pro. */
  readonly plan?: 'free' | 'pro';
  /** Сводка B680: какие отклики — автоотклики. Без опции сводка не отвечает. */
  readonly autoIds?: readonly string[];
}

export interface ResponsesMock {
  readonly calls: string[];
}

/** Вход с флагом нового кабинета и заглушки API раздела «Отклики». */
export async function mockResponses(
  page: Page,
  options: ResponsesMockOptions = {},
): Promise<ResponsesMock> {
  const applications = options.applications ?? responseFixtures();
  reviewState.reason = null;
  reviewState.helped = null;
  let companies = [...(options.companies ?? COMPANIES)];
  let failList = options.failList ?? 0;
  const calls: string[] = [];
  const automation = {
    enabled: options.automation ?? true,
    limits: { hh: 20, linkedin: 10 },
    roles: ['Руководитель разработки', 'Engineering Manager'],
  };

  await mockSignedInCabinet(page, {
    cabinetB640: true,
    billing: { initialPlan: options.plan ?? 'pro' },
    applicationHandler: async (route: Route, path: string) => {
      const method = route.request().method();
      if (path === '/api/v1/candidate/applications' && method === 'GET') {
        if (failList > 0) {
          failList -= 1;
          await route.fulfill({
            status: 500,
            json: { error: { code: 'internal', message: 'Сбой' } },
          });
          return true;
        }
        await route.fulfill({
          json: {
            data: applications,
            meta: { total: applications.length, offset: 0, limit: 100, stageCounts: {} },
          },
        });
        return true;
      }
      if (await mockReview(route, path, method, options, calls)) return true;
      const match = path.match(/^\/api\/v1\/candidate\/applications\/([^/]+)(\/events)?$/u);
      const record = match
        ? applications.find((item) => item.id === decodeURIComponent(match[1]!))
        : null;
      if (record && (method === 'PATCH' || (method === 'POST' && match?.[2]))) {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        calls.push(`${method} ${path} ${JSON.stringify(body.stage ?? body.kind ?? 'notes')}`);
        if (typeof body.stage === 'string') {
          record.stage = body.stage;
          record.stageChangedAt = new Date().toISOString();
          if (body.stage === 'rejected' || body.stage === 'archived') record.whoseTurn = null;
        }
        if ('notes' in body) record.notes = body.notes;
        if (body.kind === 'follow_up_sent') record.followUp = null;
        record.version += 1;
        await route.fulfill({ json: { data: record } });
        return true;
      }
      return false;
    },
  });

  await mockFactRewrite(page, calls);
  if (options.resumeFact) await mockResumeConversation(page);
  await page.route('**/api/v1/candidate/automation**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (method !== 'GET') calls.push(`${method} ${path}`);
    if (path.endsWith('/disable')) automation.enabled = false;
    if (path.endsWith('/enable')) automation.enabled = true;
    if (path.endsWith('/schedule') && method === 'PUT') {
      automation.limits = (
        route.request().postDataJSON() as { dailyLimits: typeof automation.limits }
      ).dailyLimits;
    }
    if (path.endsWith('/rules') && method === 'PUT') {
      automation.roles = (route.request().postDataJSON() as { roles: string[] }).roles;
    }
    const consents = ['drafts', 'send_after_approval', 'notifications'].map((key) => ({
      id: key,
      key,
      version: '1',
      text: '',
      acceptedAt: iso(30),
      revokedAt: null,
    }));
    const settings = {
      candidateId: 'candidate-fixture',
      enabled: automation.enabled,
      mode: 'approval_required',
      pausedUntil: null,
      rules: {
        roles: automation.roles,
        minimumMatchPercent: 80,
        platforms: ['hh', 'linkedin'],
        excludeStopCompanies: true,
      },
      updatedAt: null,
    };
    const schedule = {
      timezone: 'Europe/Moscow',
      dailyLimits: automation.limits,
      minPauseMinutes: 5,
      maxPauseMinutes: 15,
      sendWindows: {
        hh: { start: '09:00', end: '19:00' },
        linkedin: { start: '09:00', end: '19:00' },
      },
      quietWindows: [],
      excludedDates: [],
      breakAfterSent: 5,
      breakMinutes: 30,
      stopAfterErrors: 1,
    };
    await route.fulfill({
      json: {
        data: {
          settings,
          consents: options.automation === false ? [] : consents,
          stopCompanies: [],
          queueCounts: {},
          deliveryStats: { sentToday: 12, failedWeek: 0, attemptedWeek: 0 },
          schedule,
          schedulerRuntime: { emergencyPaused: false },
          linkedinPublishing: { enabled: false, reason: '' },
          ...schedule,
        },
      },
    });
  });

  await page.route('**/api/v1/candidate/companies/wants**', async (route) => {
    const stage = new URL(route.request().url()).searchParams.get('stage') ?? 'all';
    const items = companies.filter((item) => {
      if (stage === 'all') return true;
      if (stage === 'new') return item.hasNewVacancies === true;
      return item.wantStage === stage && item.hasNewVacancies !== true;
    });
    await route.fulfill({
      json: {
        data: {
          items,
          total: items.length,
          offset: 0,
          limit: 20,
          counts: {
            all: companies.length,
            new: companies.filter((item) => item.hasNewVacancies).length,
            want: 0,
            path: companies.filter((item) => item.wantStage === 'path').length,
            waiting: companies.filter((item) => item.wantStage === 'waiting').length,
          },
          industries: [],
        },
      },
    });
  });

  await page.route('**/api/v1/candidate/company-wants', async (route) => {
    const body = route.request().postDataJSON() as { companyName: string };
    calls.push(`PUT company-wants ${body.companyName}`);
    companies = [
      ...companies,
      company(`new-${companies.length}`, body.companyName, { industry: null }),
    ];
    await route.fulfill({
      json: { data: { key: `new-${companies.length}`, name: body.companyName } },
    });
  });

  if (options.autoIds) {
    const autoApplicationIds = options.autoIds;
    await page.route('**/api/v1/candidate/b640/responses/summary', (route) =>
      route.fulfill({ json: { data: { autoApplicationIds, approvedLetterIds: [] } } }),
    );
  }

  return { calls };
}
