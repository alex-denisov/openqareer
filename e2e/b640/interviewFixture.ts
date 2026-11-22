import type { Page, Route } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';

type Json = Record<string, unknown>;

export interface PrepMockOptions {
  /** Интервью по отклику ещё не записано — I1d. */
  readonly noInterview?: boolean;
  /** Откликов нет вовсе. */
  readonly noResponses?: boolean;
  /** B642: сервер записывает разговоры — экраны разбора I4 открыты. */
  readonly interviewRecording?: boolean;
  /** Сколько первых сохранений ответа ответить ошибкой 500. */
  readonly failPrep?: number;
  /** Компании нет в данных платформы — карточка отвечает 404. */
  readonly noCompany?: boolean;
}

export interface PrepMock {
  readonly calls: string[];
}

export const PREP_NOW = '2026-11-10T09:00:00.000Z';
const RESPONSE_ID = 'r-arka';

function response(interview: Json | null): Json {
  return {
    id: RESPONSE_ID,
    candidateId: 'candidate-fixture',
    clusterId: 'cluster-arka',
    stage: 'interview',
    closedReason: null,
    archiveReason: null,
    archivePreviousStage: null,
    processProfile: 'standard',
    vacancy: { title: 'Руководитель платформы', company: 'Арка Холдинг', url: '', source: 'hh' },
    notes: null,
    followUpDueAt: null,
    stageChangedAt: PREP_NOW,
    version: 1,
    createdAt: PREP_NOW,
    updatedAt: PREP_NOW,
    appliedAt: PREP_NOW,
    reachedStages: ['applied', 'interview'],
    followUp: null,
    whoseTurn: 'candidate',
    materials: { coverLetter: true, resume: true },
    nearestInterview: interview,
    deliveryReceipt: null,
    deliveryReceiptRecordedAt: null,
    interviewScheduledAt: interview ? [interview.scheduledAt] : [],
  };
}

const STORY = {
  id: 'story-k8s',
  title: 'переход на Kubernetes, 2024',
  fields: {
    situation: 'Платформа падала при каждом релизе',
    task: 'Перевести 40 сервисов без простоя',
    action: 'Составил план по волнам и обучил команду',
    result: 'Релизы стали еженедельными',
  },
  sourceFactIds: ['fact-k8s'],
  version: 1,
  createdAt: PREP_NOW,
  updatedAt: PREP_NOW,
  confidence: 'confirmed',
  sourceFacts: [],
};

/** Карточка компании платформы: отрасль, город, источники и рекрутер вакансии отклика. */
const COMPANY = {
  key: 'arka',
  name: 'Арка Холдинг',
  location: 'Москва',
  industry: 'Логистика',
  vacancyCount: 3,
  contactsCount: null,
  contactsImportedAt: null,
  want: false,
  nextStep: null,
  hasRecruiter: true,
  recruiterSearchStatus: 'found',
  sources: [{ name: 'hh.ru', observedAt: '2026-11-04T10:00:00.000Z' }],
  vacancies: [],
  recruiters: [
    {
      id: 'rec-1',
      companyKey: 'arka',
      vacancyId: 'cluster-arka',
      fullName: 'Сергей Минин',
      roleTitle: 'технический директор',
      email: null,
      emailStatus: 'unverified',
      phone: null,
    },
  ],
  relocation: null,
};

async function mockCompany(page: Page, options: PrepMockOptions) {
  await page.route('**/api/v1/candidate/b640/companies/*', (route) =>
    options.noCompany
      ? route.fulfill({ status: 404, json: { error: { message: 'not found' } } })
      : route.fulfill({
          json: {
            data: {
              company: COMPANY,
              roleVacancies: [],
              roleTotal: 0,
              roleNextOffset: null,
              otherVacancies: [],
              otherTotal: 0,
              applications: {},
            },
          },
        }),
  );
}

interface State {
  interview: Json | null;
  paragraphs: Json[];
  prepFails: number;
}

async function handleApplications(
  route: Route,
  path: string,
  state: State,
  options: PrepMockOptions,
  calls: string[],
) {
  const method = route.request().method();
  if (path === '/api/v1/candidate/applications' && method === 'GET') {
    const items = options.noResponses ? [] : [response(state.interview)];
    await route.fulfill({
      json: { data: items, meta: { total: items.length, offset: 0, limit: 100, stageCounts: {} } },
    });
    return true;
  }
  if (path === `/api/v1/candidate/applications/${RESPONSE_ID}/interviews` && method === 'POST') {
    const body = route.request().postDataJSON() as { scheduledAt: string };
    state.interview = { id: 'iv-1', scheduledAt: body.scheduledAt, prepStatus: 'none', round: 1 };
    calls.push(`POST interview ${body.scheduledAt}`);
    await route.fulfill({
      status: 201,
      json: { data: { ...state.interview, applicationId: RESPONSE_ID } },
    });
    return true;
  }
  if (path === `/api/v1/candidate/applications/${RESPONSE_ID}/star-prep`) {
    if (method === 'PUT') {
      if (state.prepFails > 0) {
        state.prepFails -= 1;
        await route.fulfill({ status: 500, json: { error: { message: 'fail' } } });
        return true;
      }
      state.paragraphs = (route.request().postDataJSON() as { paragraphs: Json[] }).paragraphs;
      calls.push(
        `PUT star-prep ${state.paragraphs.map((p) => `${String(p.questionId)}:${String(p.field)}`).join(',')}`,
      );
    }
    await route.fulfill({
      json: {
        data: {
          applicationId: RESPONSE_ID,
          paragraphs: state.paragraphs,
          version: 1,
          updatedAt: PREP_NOW,
        },
      },
    });
    return true;
  }
  return false;
}

/** «Подготовка» B640: отклик в «Арка Холдинг» с интервью 12 ноября, одна история с фактом, планка 500 тыс. ₽. */
export async function mockPrep(page: Page, options: PrepMockOptions = {}): Promise<PrepMock> {
  const calls: string[] = [];
  const state: State = {
    interview: options.noInterview
      ? null
      : {
          id: 'iv-1',
          scheduledAt: '2026-11-12T12:00:00.000Z',
          prepStatus: 'none',
          round: 1,
          format: 'видеозвонок с техническим директором',
        },
    paragraphs: [],
    prepFails: options.failPrep ?? 0,
  };
  await mockSignedInCabinet(page, {
    cabinetB640: true,
    interviewRecording: options.interviewRecording ?? false,
    billing: { initialPlan: 'pro' },
    applicationHandler: (route, path) => handleApplications(route, path, state, options, calls),
  });
  await page.route('**/api/v1/candidate/decision-profile', (route) =>
    route.fulfill({ json: { data: { salaryFloor: 500_000, salaryCurrency: 'RUB' } } }),
  );
  await page.route('**/api/v1/candidate/star-stories', (route) =>
    route.fulfill({ json: { data: { stories: [STORY], facts: [] } } }),
  );
  await mockCompany(page, options);
  return { calls };
}
