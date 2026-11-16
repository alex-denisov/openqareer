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

export interface ResponsesMockOptions {
  readonly applications?: Stub[];
  readonly companies?: readonly Record<string, unknown>[];
  /** Автоотклики включены и согласия даны. */
  readonly automation?: boolean;
  /** Сколько раз список откликов отвечает ошибкой, прежде чем отдать данные. */
  readonly failList?: number;
  /** Тариф: на Free автооткликов нет. По умолчанию Pro. */
  readonly plan?: 'free' | 'pro';
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

  return { calls };
}
