import type { Page, Route } from '@playwright/test';
import type { MatchedVacancyFacets } from '../../shared/matchedVacancyFacets';
import type { VacancyFitView } from '../../shared/vacancyFit';
import {
  RELOCATION_CONSENT_VERSION,
  relocationAlerts as buildRelocationAlerts,
  type RelocationCurrentStep,
  type RelocationQuestionnaire,
} from '../../shared/relocationQuestionnaire';
import type { VacanciesScreenState } from '../../src/features/vacancies/vacanciesScreenState';
import { mockNotificationRequest } from './mockNotifications';
import {
  createRoleSkillAssessmentFixture,
  type MockSignedInCabinetOptions as MockRoleSkillAssessmentOptions,
} from './mockRoleSkillAssessment';
import { mockInterviewSimulatorRoutes } from './mockInterviewSimulator';
import { createMockStarStoriesFixture } from './mockStarStories';
import { mockCandidateCompanies, type MockCandidateCompanyOptions } from './mockCandidateCompanies';
import {
  account,
  candidate,
  candidateSnapshot,
  matchedVacancyPage,
  roleHypotheses,
  todaySnapshot,
  workspace,
} from './readabilityWorkspace';
import type { ResumeDraft } from '../../server/domain/resumeDraft';
import type { CandidateConnection } from '../../src/features/coach/coachApi';

export interface MockCareerDiaryFixture {
  overview: Record<string, unknown>;
  goals: Array<Record<string, unknown> & { id: string }>;
  workplace: (Record<string, unknown> & { id: string }) | null;
  workplaces?: Array<Record<string, unknown> & { id: string }>;
  profileExperience?: Record<string, unknown> & { id: string };
  createdByIdempotencyKey?: Record<string, string>;
}

async function mockEmptyCareerDiaryRoutes(
  route: Route,
  path: string,
  base: string,
): Promise<boolean> {
  if (route.request().method() !== 'GET') {
    await route.fulfill({
      status: 501,
      json: {
        error: {
          code: 'career_diary_write_not_stubbed',
          message: 'Запись дневника не настроена в этой браузерной фикстуре.',
        },
      },
    });
    return true;
  }
  if (path === base) {
    await route.fulfill({
      json: {
        data: {
          asOf: '2026-10-10',
          primaryWorkplace: null,
          summary: {
            goalsAchieved: 0,
            goalsAtRisk: 0,
            goalsTotal: 0,
            achievementsReadyToAdd: 0,
            weeklyReviewsTotal: 0,
            weeklyReviewsInRow: 0,
          },
        },
      },
    });
    return true;
  }
  if (
    [`${base}/goals`, `${base}/reviews`, `${base}/achievements`, `${base}/workplaces`].includes(
      path,
    ) ||
    (path.startsWith(`${base}/goals/`) && path.endsWith('/measurements'))
  ) {
    await route.fulfill({ json: { data: { items: [], nextCursor: null } } });
    return true;
  }
  await route.fulfill({ status: 404, json: { error: { code: 'diary_entry_not_found' } } });
  return true;
}

async function mockCareerDiaryFixtureRoutes(
  route: Route,
  path: string,
  base: string,
  fixture: MockCareerDiaryFixture,
): Promise<boolean> {
  const method = route.request().method();
  if (path === base && method === 'GET') {
    await route.fulfill({ json: { data: fixture.overview } });
    return true;
  }
  if (path === `${base}/goals` && method === 'GET') {
    await route.fulfill({ json: { data: { items: fixture.goals, nextCursor: null } } });
    return true;
  }
  if (path === `${base}/workplaces` && method === 'GET') {
    const items = mockCareerDiaryWorkplaces(fixture);
    await route.fulfill({ json: { data: { items, nextCursor: null } } });
    return true;
  }
  if (path.startsWith(`${base}/goals/`) && path.endsWith('/measurements') && method === 'GET') {
    await route.fulfill({ json: { data: { items: [], nextCursor: null } } });
    return true;
  }
  if (path === `${base}/reviews` && method === 'GET') {
    await route.fulfill({ json: { data: { items: [], nextCursor: null } } });
    return true;
  }
  if (path === `${base}/achievements` && method === 'GET') {
    await route.fulfill({ json: { data: { items: [], nextCursor: null } } });
    return true;
  }
  if (path === `${base}/workplaces` && method === 'POST') {
    return mockCreateWorkplace(route, fixture);
  }
  const primaryId = routeWorkplaceActionId(path, base, 'primary');
  if (primaryId) return mockSetPrimaryWorkplace(route, method, fixture, primaryId);
  const archiveId = routeWorkplaceActionId(path, base, 'archive');
  if (archiveId) return mockArchiveWorkplace(route, method, fixture, archiveId);
  const workplaceId = routeResourceId(path, base, 'workplaces');
  if (workplaceId !== null) return mockWorkplaceRequest(route, method, fixture, workplaceId);
  const goalId = routeResourceId(path, base, 'goals');
  if (goalId !== null) return mockGoalRequest(route, method, fixture, goalId);
  await route.fulfill({ status: 404, json: { error: { code: 'diary_entry_not_found' } } });
  return true;
}

function routeResourceId(path: string, base: string, collection: string): string | null {
  const prefix = `${base}/${collection}/`;
  if (!path.startsWith(prefix)) return null;
  const encodedId = path.slice(prefix.length);
  if (!encodedId || encodedId.includes('/')) return null;
  return decodeURIComponent(encodedId);
}

function routeWorkplaceActionId(
  path: string,
  base: string,
  action: 'primary' | 'archive',
): string | null {
  const prefix = `${base}/workplaces/`;
  const suffix = `/${action}`;
  if (!path.startsWith(prefix) || !path.endsWith(suffix)) return null;
  const encodedId = path.slice(prefix.length, -suffix.length);
  return encodedId && !encodedId.includes('/') ? decodeURIComponent(encodedId) : null;
}

function mockCareerDiaryWorkplaces(
  fixture: MockCareerDiaryFixture,
): Array<Record<string, unknown> & { id: string }> {
  if (fixture.workplaces) return fixture.workplaces;
  fixture.workplaces = fixture.workplace ? [fixture.workplace] : [];
  return fixture.workplaces;
}

export function mockProfileSnapshot(fixture?: MockCareerDiaryFixture) {
  const snapshot = structuredClone(candidateSnapshot);
  const experience = fixture?.profileExperience;
  if (experience && snapshot.resume) {
    const draft = snapshot.resume.draft as ResumeDraft;
    Object.assign(draft, {
      experience: [experience as unknown as ResumeDraft['experience'][number]],
    });
  }
  return snapshot;
}

async function mockWorkplaceRequest(
  route: Route,
  method: string,
  fixture: MockCareerDiaryFixture,
  workplaceId: string,
): Promise<boolean> {
  const workplaces = mockCareerDiaryWorkplaces(fixture);
  const index = workplaces.findIndex((item) => item.id === workplaceId);
  if (index < 0) {
    await route.fulfill({
      status: 404,
      json: { error: { code: 'career_diary_record_not_found' } },
    });
    return true;
  }
  if (method === 'GET') {
    await route.fulfill({ json: { data: workplaces[index] } });
    return true;
  }
  if (method !== 'PATCH') {
    await route.fulfill({ status: 405, json: { error: { code: 'method_not_allowed' } } });
    return true;
  }
  const patch = route.request().postDataJSON() as Record<string, unknown>;
  if (workplaces[index]?.status === 'archived' && 'planning' in patch) {
    await route.fulfill({
      status: 409,
      json: { error: { code: 'career_diary_workplace_archived' } },
    });
    return true;
  }
  workplaces[index] = { ...workplaces[index]!, ...patch };
  if (fixture.workplace?.id === workplaceId) {
    fixture.workplace = workplaces[index]!;
    fixture.overview = { ...fixture.overview, primaryWorkplace: fixture.workplace };
  }
  await route.fulfill({ json: { data: workplaces[index] } });
  return true;
}

async function mockCreateWorkplace(
  route: Route,
  fixture: MockCareerDiaryFixture,
): Promise<boolean> {
  const input = route.request().postDataJSON() as Record<string, unknown>;
  const key = route.request().headers()['idempotency-key'] ?? '';
  const existingId = fixture.createdByIdempotencyKey?.[key];
  if (existingId) {
    const existing = mockCareerDiaryWorkplaces(fixture).find((item) => item.id === existingId);
    if (existing) {
      await route.fulfill({ json: { data: existing } });
      return true;
    }
  }
  const id = `workplace-created-${mockCareerDiaryWorkplaces(fixture).length + 1}`;
  const workplace = {
    id,
    company: String(input.company ?? ''),
    title: String(input.title ?? ''),
    startDate: String(input.startDate ?? ''),
    endDate: null,
    sourceExperienceId: null,
    status: 'active',
    isPrimary: false,
    createdAt: '2026-12-06T12:00:00.000Z',
    updatedAt: '2026-12-06T12:00:00.000Z',
  };
  mockCareerDiaryWorkplaces(fixture).push(workplace);
  fixture.createdByIdempotencyKey = { ...fixture.createdByIdempotencyKey, [key]: id };
  await route.fulfill({ status: 201, json: { data: workplace } });
  return true;
}

async function mockSetPrimaryWorkplace(
  route: Route,
  method: string,
  fixture: MockCareerDiaryFixture,
  workplaceId: string,
): Promise<boolean> {
  if (method !== 'PUT') {
    await route.fulfill({ status: 405, json: { error: { code: 'method_not_allowed' } } });
    return true;
  }
  const workplaces = mockCareerDiaryWorkplaces(fixture);
  const selected = workplaces.find((item) => item.id === workplaceId);
  if (!selected) {
    await route.fulfill({
      status: 404,
      json: { error: { code: 'career_diary_record_not_found' } },
    });
    return true;
  }
  fixture.workplaces = workplaces.map((item) => ({ ...item, isPrimary: item.id === workplaceId }));
  fixture.workplace = fixture.workplaces.find((item) => item.id === workplaceId) ?? null;
  fixture.overview = { ...fixture.overview, primaryWorkplace: fixture.workplace };
  await route.fulfill({ json: { data: fixture.workplace } });
  return true;
}

async function mockArchiveWorkplace(
  route: Route,
  method: string,
  fixture: MockCareerDiaryFixture,
  workplaceId: string,
): Promise<boolean> {
  if (method !== 'PUT') {
    await route.fulfill({ status: 405, json: { error: { code: 'method_not_allowed' } } });
    return true;
  }
  const workplaces = mockCareerDiaryWorkplaces(fixture);
  const index = workplaces.findIndex((item) => item.id === workplaceId);
  if (index < 0) {
    await route.fulfill({
      status: 404,
      json: { error: { code: 'career_diary_record_not_found' } },
    });
    return true;
  }
  workplaces[index] = {
    ...workplaces[index]!,
    status: 'archived',
    endDate: '2026-12-06',
    isPrimary: false,
  };
  if (fixture.workplace?.id === workplaceId) {
    fixture.workplace = null;
    fixture.overview = { ...fixture.overview, primaryWorkplace: null };
  }
  await route.fulfill({ json: { data: workplaces[index] } });
  return true;
}

async function mockGoalRequest(
  route: Route,
  method: string,
  fixture: MockCareerDiaryFixture,
  goalId: string,
): Promise<boolean> {
  const index = fixture.goals.findIndex((goal) => goal.id === goalId);
  if (index < 0) {
    await route.fulfill({
      status: 404,
      json: { error: { code: 'career_diary_record_not_found' } },
    });
    return true;
  }
  if (method === 'GET') {
    await route.fulfill({ json: { data: fixture.goals[index] } });
    return true;
  }
  if (method !== 'PATCH') {
    await route.fulfill({ status: 405, json: { error: { code: 'method_not_allowed' } } });
    return true;
  }
  const patch = route.request().postDataJSON() as Record<string, unknown>;
  fixture.goals[index] = { ...fixture.goals[index]!, ...patch };
  await route.fulfill({ json: { data: fixture.goals[index] } });
  return true;
}

export async function mockCareerDiaryRoutes(
  route: Route,
  path: string,
  fixture?: MockCareerDiaryFixture,
): Promise<boolean> {
  const base = '/api/v1/candidate/career-diary';
  if (!path.startsWith(base)) return false;
  if (!fixture) return mockEmptyCareerDiaryRoutes(route, path, base);
  return mockCareerDiaryFixtureRoutes(route, path, base, fixture);
}

interface ApplicationStub {
  readonly id: string;
  readonly candidateId: string;
  readonly clusterId: string | null;
  stage: string;
  archivePreviousStage: string | null;
  version: number;
  readonly vacancy: unknown;
  readonly stageChangedAt?: string;
  readonly createdAt: string;
  updatedAt: string;
}

type FixturePaidPlan = 'basic' | 'pro' | 'max';
type FixtureCurrentPlan = 'free' | FixturePaidPlan;
type FixtureCheckoutStatus = 'pending' | 'processing' | 'paid' | 'failed';
type FixtureExecutiveStatus = 'submitted' | 'waitlisted';

interface FixtureInvoice {
  readonly invoiceId: number;
  readonly planId: FixturePaidPlan;
  readonly amountKopecks: number;
  readonly currency: 'RUB';
  readonly status: FixtureCheckoutStatus;
  readonly autoRenew: boolean;
  readonly paymentUrl: string;
  readonly createdAt: string;
  readonly idempotencyKey: string;
}

interface FixtureReceipt {
  readonly invoiceId: number;
  readonly planId: FixturePaidPlan;
  readonly amountKopecks: number;
  readonly currency: 'RUB';
  readonly paidAt: string | null;
  readonly paymentMethod: string | null;
  readonly receiptUrl: string | null;
  readonly receiptStatus: string | null;
  readonly fiscalDocumentNumber: string | null;
  readonly fiscalDate: string | null;
}

/** The calendar day the shared cabinet fixtures were written for. */
export const FIXTURE_NOW = new Date('2026-10-14T06:00:00.000Z');

export interface MockSignedInCabinetOptions extends MockRoleSkillAssessmentOptions {
  /** Freeze Date at FIXTURE_NOW for specs that compare fixture dates with the present. */
  readonly freezeNow?: boolean;
  readonly candidateId?: string;
  readonly careerDiary?: MockCareerDiaryFixture;
  readonly vacancyTotal?: number;
  readonly vacancyFacets?: MatchedVacancyFacets;
  /** B552: fit analysis of the first matched vacancy, also served by its /fit route. */
  readonly firstVacancyFitView?: VacancyFitView;
  readonly vacancyInitialFilters?: VacanciesScreenState;
  readonly savedVacanciesCount?: number;
  readonly companyCount?: number;
  readonly companyDirectory?: Omit<MockCandidateCompanyOptions, 'companyCount'>;
  readonly billing?: {
    readonly initialPlan?: FixtureCurrentPlan;
    readonly subscriptionStatus?: 'active' | 'past_due' | 'canceled' | 'expired';
    readonly autoRenew?: boolean;
    readonly checkoutStatuses?: readonly FixtureCheckoutStatus[];
    readonly executiveStatus?: FixtureExecutiveStatus;
  };
  readonly automationQueue?: readonly AutomationQueueFixtureItem[];
  readonly automationQueueBehavior?: {
    readonly delayMs?: number;
    readonly errorStatus?: number;
    readonly totalOverride?: number;
  };
  readonly automationSnapshotDelayMs?: number;
  readonly automation?: {
    readonly settings?: Partial<AutomationFixtureState['settings']>;
    readonly runtime?: Partial<AutomationFixtureState['runtime']>;
  };
  readonly accountNotificationHandler?: (route: Route, path: string) => Promise<boolean>;
  readonly accountConnections?: readonly CandidateConnection[];
  readonly notificationHandler?: (route: Route, path: string) => Promise<boolean>;
  readonly applicationHandler?: (route: Route, path: string) => Promise<boolean>;
  readonly linkedinDrafts?: readonly Record<string, unknown>[];
  readonly linkedinDraftTopics?: readonly Record<string, unknown>[];
  readonly linkedinDraftCadence?: Partial<LinkedinDraftFixtureState['cadence']>;
  readonly relocation?: {
    readonly consentGranted?: boolean;
    readonly currentStep?: RelocationCurrentStep;
    readonly citizenshipCountryCodes?: readonly string[];
    readonly documents?: readonly {
      readonly id: string;
      readonly kind:
        'residence_permit' | 'work_permit' | 'work_visa' | 'study_visa' | 'visa' | 'other';
      readonly countryCode: string;
      readonly issuedAt?: string;
      readonly expiresAt?: string;
    }[];
  };
}

function withFirstFitView(
  page: ReturnType<typeof matchedVacancyPage>,
  offset: number,
  fitView: VacancyFitView | undefined,
): ReturnType<typeof matchedVacancyPage> {
  if (!fitView || offset !== 0 || page.data.length === 0) return page;
  const [first, ...rest] = page.data;
  return {
    ...page,
    data: [{ ...first!, explanation: { ...first!.explanation, fitView } }, ...rest],
  };
}

function seedInitialVacancyItems(
  items: ReturnType<typeof matchedVacancyPage>['data'],
): typeof items {
  return items.map((item, index) => {
    // Keep the original Berlin Product Lead fixture for the later action flow.
    if (index >= 6 || index === 1) return item;
    const sourceId = index % 2 === 0 ? 'hh' : 'linkedin';
    return {
      ...item,
      cluster: {
        ...item.cluster,
        canonicalLocation: 'Москва',
        salary: { from: 500_000, to: 650_000, currency: '₽' },
        isRemote: index % 2 === 0,
        descriptionSummary:
          index % 2 === 0
            ? item.cluster.descriptionSummary
            : `${item.cluster.descriptionSummary} Гибридный формат работы.`,
        sources: item.cluster.sources.map((source, sourceIndex) =>
          sourceIndex === 0
            ? {
                ...source,
                sourceType: sourceId === 'hh' ? 'json_api' : 'jobspy',
                sourceId,
                sourceName: sourceId === 'hh' ? 'hh.ru' : 'LinkedIn',
              }
            : source,
        ),
      },
    };
  });
}

async function mockCandidateNotificationRoutes(
  route: Route,
  path: string,
  options: MockSignedInCabinetOptions,
): Promise<boolean> {
  if (path.startsWith('/api/v1/candidate/notifications') && options.accountNotificationHandler) {
    if (await options.accountNotificationHandler(route, path)) return true;
  }
  if (path.startsWith('/api/v1/candidate/notifications') && options.notificationHandler) {
    if (await options.notificationHandler(route, path)) return true;
  }
  if (/^\/api\/v1\/candidate\/applications(?:\/|$)/u.test(path) && options.applicationHandler) {
    if (await options.applicationHandler(route, path)) return true;
  }
  return mockNotificationRequest(route, path);
}

function savedApplicationFixtures(count: number): ApplicationStub[] {
  const timestamp = '2026-10-10T00:00:00.000Z';
  return Array.from({ length: count }, (_, index) => {
    const sequence = index + 1;
    return {
      id: `saved-fixture-${sequence}`,
      candidateId: 'candidate-fixture',
      clusterId: `saved-cluster-${sequence}`,
      stage: 'saved',
      archivePreviousStage: null,
      version: 1,
      vacancy: {
        title: `Saved role ${sequence}`,
        company: `Saved company ${sequence}`,
        url: `https://example.test/saved/${sequence}`,
        source: 'fixture',
      },
      // B550: дата сохранения убывает с номером — порядок «по дате» совпадает с исходным.
      stageChangedAt: new Date(Date.parse(timestamp) - index * 6 * 3_600_000).toISOString(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  });
}

/**
 * B550: первая сохранённая закрылась на площадке, третьей нет в каталоге,
 * у чётных указана вилка; найденные — Head в Москве, совпадают с условиями.
 */
function savedVacancyStateFixtures(ids: readonly string[]): Record<string, unknown> {
  const inCatalog = {
    inCatalog: true,
    vacancyLevel: 'head',
    levelMatch: 'match',
    location: 'Москва',
    isRemote: false,
    outsideGeography: false,
  };
  return Object.fromEntries(
    ids
      .filter((id) => id.startsWith('saved-cluster-'))
      .map((id) => {
        const sequence = Number(id.slice('saved-cluster-'.length));
        if (sequence === 1)
          return [id, { ...inCatalog, closed: true, closedAt: '2026-10-06T09:00:00.000Z' }];
        if (sequence === 3) return [id, { closed: false, inCatalog: false }];
        return [
          id,
          sequence % 2 === 0
            ? {
                ...inCatalog,
                closed: false,
                salary: { from: sequence * 50_000, to: sequence * 60_000, currency: 'RUR' },
              }
            : { ...inCatalog, closed: false },
        ];
      }),
  );
}

async function mockLineCRoutes(
  route: Route,
  path: string,
  options: MockSignedInCabinetOptions,
  assessmentFixture: ReturnType<typeof createRoleSkillAssessmentFixture>,
  starStoriesFixture: ReturnType<typeof createMockStarStoriesFixture>,
): Promise<boolean> {
  const method = route.request().method();
  const isAssessmentRoute = path.startsWith('/api/v1/candidate/role-skill-assessments/');
  const isStarStoryRoute =
    path === '/api/v1/candidate/star-stories' || path.startsWith('/api/v1/candidate/star-stories/');
  if (!isAssessmentRoute && !isStarStoryRoute) return false;

  if (isAssessmentRoute && path.endsWith('/current') && options.assessmentDelayMs) {
    await new Promise((resolve) => setTimeout(resolve, options.assessmentDelayMs));
  }

  let body: Record<string, unknown> = {};
  if (method === 'POST' || method === 'PATCH') {
    try {
      body = route.request().postDataJSON() as Record<string, unknown>;
    } catch {
      return false;
    }
  }
  const response = isAssessmentRoute
    ? assessmentFixture.handle(path, method, body)
    : starStoriesFixture.handle(path, method, body);
  if (!response) return false;
  if (response.error) {
    await route.fulfill({
      status: response.status ?? 400,
      json: { error: response.error },
    });
    return true;
  }
  await route.fulfill({
    status: response.status ?? 200,
    json: { data: response.data },
  });
  return true;
}

interface AutomationFixtureState {
  settings: {
    candidateId: string;
    enabled: boolean;
    mode: string;
    pausedUntil: string | null;
    rules: Record<string, unknown>;
    updatedAt: string | null;
  };
  consents: Array<Record<string, unknown>>;
  stops: Array<{ company: string; origin: string; createdAt: string }>;
  queue: AutomationQueueFixtureItem[];
  schedule: Record<string, unknown>;
  runtime: Record<string, unknown>;
  journal: AutomationJournalFixtureEntry[];
  queueBehavior: { delayMs?: number; errorStatus?: number; totalOverride?: number };
  snapshotDelayMs?: number;
}

interface AutomationJournalFixtureEntry {
  id: string;
  queueItemId: string;
  platform: string;
  result: 'delivered' | 'error' | 'removed';
  company: string;
  occurredAt: string;
  receiptId: string | null;
  failureCode: string | null;
}

interface LinkedinDraftFixtureState {
  readonly candidateId: string;
  drafts: Array<Record<string, unknown>>;
  topics: Array<Record<string, unknown>>;
  cadence: {
    timezone: string;
    lastPublishedAt: string | null;
    nextAllowedAt: string | null;
    canPublish: boolean;
  };
  nextDraftId: number;
}

export interface AutomationQueueFixtureItem {
  id: string;
  status: string;
  sendTiming: string;
  createdAt?: string;
  updatedAt?: string;
  payload: {
    clusterId: string;
    applicationId: string | null;
    platform: string;
    title: string;
    role: string;
    company: string;
    targetUrl: string;
    requirements: { matched: number; total: number };
    letterText: string;
    materials: Array<{ documentId: string; kind: string; fileName: string; version: number }>;
  };
}

const AUTOMATION_CONSENT_TEXT: Readonly<Record<string, string>> = {
  drafts: 'Разрешаю готовить черновики откликов и писем по выбранным мной вакансиям.',
  send_after_approval: 'Разрешаю отправлять каждый отклик только после моего отдельного одобрения.',
  notifications: 'Разрешаю показывать очередь и журнал автооткликов в уведомлениях приложения.',
  automatic_submission:
    'Разрешаю отправлять подходящие отклики без отдельного одобрения каждого, в рамках выбранных правил и тарифных лимитов.',
};
const AUTOMATION_REQUIRED_CONSENTS = ['drafts', 'send_after_approval', 'notifications'] as const;

function createAutomationFixtureState(
  options: MockSignedInCabinetOptions = {},
): AutomationFixtureState {
  const candidateId = options.candidateId ?? 'readability-candidate';
  const settings = createAutomationSettings(candidateId, options.automation?.settings);
  return {
    settings,
    consents: fixtureAutomationConsents(settings.enabled),
    stops: [],
    queue: (options.automationQueue ?? []).map((item) => ({
      ...item,
      payload: { ...item.payload, materials: [...item.payload.materials] },
    })),
    schedule: defaultAutomationSchedule(),
    runtime: { ...defaultAutomationRuntime(), ...options.automation?.runtime },
    journal: [],
    queueBehavior: { ...options.automationQueueBehavior },
    snapshotDelayMs: options.automationSnapshotDelayMs,
  };
}

function createAutomationSettings(
  candidateId: string,
  overrides?: Partial<AutomationFixtureState['settings']>,
): AutomationFixtureState['settings'] {
  return {
    enabled: false,
    mode: 'drafts_only',
    pausedUntil: null,
    rules: {
      roles: [],
      minimumMatchPercent: 80,
      platforms: ['hh', 'linkedin'],
      excludeStopCompanies: true,
    },
    updatedAt: null,
    ...overrides,
    candidateId,
  };
}

function fixtureAutomationConsents(enabled: boolean): AutomationFixtureState['consents'] {
  if (!enabled) return [];
  const acceptedAt = '2026-10-09T08:00:00.000Z';
  return AUTOMATION_REQUIRED_CONSENTS.map((key) => ({
    id: `consent-${key}`,
    key,
    version: 'B452-2026-10-10-v1',
    text: AUTOMATION_CONSENT_TEXT[key] ?? '',
    acceptedAt,
    revokedAt: null,
  }));
}

function defaultAutomationSchedule(): Record<string, unknown> {
  return {
    timezone: 'Europe/Moscow',
    dailyLimits: { hh: 15, linkedin: 10 },
    minPauseMinutes: 2,
    maxPauseMinutes: 9,
    sendWindows: {
      hh: { start: '10:00', end: '18:00', days: [1, 2, 3, 4, 5] },
      linkedin: { start: '09:00', end: '17:00', days: [1, 2, 3, 4] },
    },
    quietWindows: [
      { start: '22:00', end: '08:00' },
      { start: '13:00', end: '14:00' },
    ],
    excludedDates: [],
    breakAfterSent: 8,
    breakMinutes: 120,
    stopAfterErrors: 1,
  };
}

function defaultAutomationRuntime(): Record<string, unknown> {
  return {
    status: 'ready',
    emergencyPaused: false,
    consecutiveErrors: 0,
    sentSinceBreak: 0,
    nextSendAt: null,
    pauseUntil: null,
  };
}

function automationState(state: AutomationFixtureState) {
  const queueCounts = Object.fromEntries(
    [
      'letter_not_ready',
      'pending_approval',
      'approved',
      'removed',
      'consultant',
      'sent',
      'attempted',
      'failed',
    ].map((status) => [status, state.queue.filter((item) => item.status === status).length]),
  );
  return {
    settings: state.settings,
    consents: state.consents,
    stopCompanies: state.stops,
    queueCounts,
    schedule: state.schedule,
    schedulerRuntime: state.runtime,
    linkedinPublishing: { enabled: false, reason: 'Публикацию в LinkedIn запускает кандидат.' },
  };
}

function applyAutomationAction(
  state: AutomationFixtureState,
  item: AutomationQueueFixtureItem,
  action: string,
): void {
  if ((action === 'remove' || action === 'stop_company') && item.status !== 'removed') {
    recordAutomationRemoval(state, item);
  }
  item.status =
    action === 'approve_and_send' ? 'approved' : action === 'consultant' ? 'consultant' : 'removed';
  if (action === 'stop_company') {
    const company = item.payload.company;
    state.stops = [
      ...state.stops.filter((stop) => stop.company !== company),
      { company, origin: 'manual', createdAt: new Date().toISOString() },
    ];
    state.queue
      .filter(
        (queued) =>
          queued.payload.company === company && !['sent', 'removed'].includes(queued.status),
      )
      .forEach((queued) => {
        recordAutomationRemoval(state, queued);
        queued.status = 'removed';
        queued.payload = { ...queued.payload, targetUrl: '', letterText: '', materials: [] };
      });
  }
  if (item.status === 'removed')
    item.payload = { ...item.payload, targetUrl: '', letterText: '', materials: [] };
}

function automationQueueSummary(item: AutomationQueueFixtureItem, candidateId: string) {
  return {
    id: item.id,
    candidateId,
    applicationId: item.payload.applicationId,
    status: item.status,
    displayStatus:
      item.status === 'pending_approval'
        ? item.sendTiming === 'today'
          ? 'will_send_today'
          : 'will_send_later'
        : item.status,
    sendTiming: item.sendTiming,
    createdAt: item.createdAt ?? '2026-10-09T08:00:00.000Z',
    updatedAt: item.updatedAt ?? '2026-10-09T08:00:00.000Z',
    clusterId: item.payload.clusterId,
    platform: item.payload.platform,
    title: item.payload.title,
    role: item.payload.role,
    company: item.payload.company,
    requirements: item.payload.requirements,
    letterReady: item.payload.letterText.trim().length > 0,
    materialCount: item.payload.materials.length,
  };
}

function recordAutomationRemoval(
  state: AutomationFixtureState,
  item: AutomationQueueFixtureItem,
): void {
  state.journal.push({
    id: `journal-${state.journal.length + 1}`,
    queueItemId: item.id,
    platform: item.payload.platform,
    result: 'removed',
    company: item.payload.company,
    occurredAt: new Date().toISOString(),
    receiptId: null,
    failureCode: null,
  });
}

async function mockAutomationConfiguration(
  route: Route,
  path: string,
  state: AutomationFixtureState,
): Promise<boolean> {
  const method = route.request().method();
  if (path.endsWith('/candidate/automation') && method === 'GET') {
    if (state.snapshotDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, state.snapshotDelayMs));
    }
    await route.fulfill({ json: { data: automationState(state) } });
    return true;
  }
  if (path.endsWith('/candidate/automation/enable') && method === 'POST') {
    const body = route.request().postDataJSON() as {
      mode: string;
      rules?: Record<string, unknown>;
      consentKeys: string[];
    };
    const acceptedAt = new Date().toISOString();
    state.settings = {
      ...state.settings,
      enabled: true,
      mode: body.mode,
      rules: body.rules ?? state.settings.rules,
      updatedAt: acceptedAt,
    };
    if (!state.runtime.emergencyPaused)
      state.runtime = { ...state.runtime, status: 'ready', nextSendAt: acceptedAt };
    state.consents = body.consentKeys.map((key) => ({
      id: `consent-${key}`,
      key,
      version: 'B452-2026-10-10-v1',
      text: AUTOMATION_CONSENT_TEXT[key] ?? '',
      acceptedAt,
      revokedAt: null,
    }));
    await route.fulfill({ json: { data: automationState(state) } });
    return true;
  }
  if (path.endsWith('/candidate/automation/disable') && method === 'POST') {
    state.settings = { ...state.settings, enabled: false };
    state.runtime = { ...state.runtime, status: 'prepared', nextSendAt: null };
    state.queue
      .filter((item) => item.status === 'approved')
      .forEach((item) => {
        item.status = 'pending_approval';
      });
    await route.fulfill({ json: { data: { settings: state.settings } } });
    return true;
  }
  return updateAutomationConfiguration(route, path, state);
}

async function mockAutomationScheduler(
  route: Route,
  path: string,
  url: URL,
  state: AutomationFixtureState,
): Promise<boolean> {
  const method = route.request().method();
  if (path.endsWith('/candidate/automation/schedule')) {
    if (method === 'PUT') {
      state.schedule = route.request().postDataJSON() as Record<string, unknown>;
      if (!state.runtime.emergencyPaused)
        state.runtime = { ...state.runtime, status: 'ready', nextSendAt: new Date().toISOString() };
    }
    if (method === 'GET' || method === 'PUT') {
      await route.fulfill({
        json: {
          data: {
            schedule: state.schedule,
            runtime: state.runtime,
            stateLabel: fixtureAutomationStateLabel(String(state.runtime.status)),
          },
        },
      });
      return true;
    }
  }
  if (path.endsWith('/candidate/automation/emergency-pause') && method === 'POST') {
    state.runtime = { ...state.runtime, emergencyPaused: true, status: 'paused', nextSendAt: null };
    await route.fulfill({ json: { data: { runtime: state.runtime, stateLabel: 'Пауза' } } });
    return true;
  }
  if (path.endsWith('/candidate/automation/dispatch') && method === 'POST') {
    await route.fulfill({ status: 503, json: { error: { code: 'runner_not_connected' } } });
    return true;
  }
  if (path.endsWith('/candidate/automation/journal/export') && method === 'GET') {
    await route.fulfill({
      status: 200,
      contentType: 'text/csv; charset=utf-8',
      body: '\uFEFFВремя,Компания,Канал,Результат,Квитанция,Код ошибки',
    });
    return true;
  }
  if (path.endsWith('/candidate/automation/journal') && method === 'GET') {
    const result = url.searchParams.get('result');
    const platform = url.searchParams.get('platform');
    const entries = state.journal.filter(
      (entry) => (!result || entry.result === result) && (!platform || entry.platform === platform),
    );
    const counts = state.journal.reduce(
      (value, entry) => ({
        total: value.total + 1,
        delivered: value.delivered + Number(entry.result === 'delivered'),
        errors: value.errors + Number(entry.result === 'error'),
        removed: value.removed + Number(entry.result === 'removed'),
      }),
      { total: 0, delivered: 0, errors: 0, removed: 0 },
    );
    await route.fulfill({
      json: {
        data: { entries, periodDays: Number(url.searchParams.get('periodDays') ?? 30), counts },
      },
    });
    return true;
  }
  return false;
}

function fixtureAutomationStateLabel(status: string): string {
  if (status === 'daily_limit_reached') return 'Лимит дня достигнут';
  if (status === 'linkedin_not_connected') return 'LinkedIn не подключён';
  if (status === 'paused') return 'Пауза';
  if (status === 'error') return 'Ошибка отправки';
  return status === 'prepared' ? 'Подготовлено' : 'По расписанию';
}

async function updateAutomationConfiguration(
  route: Route,
  path: string,
  state: AutomationFixtureState,
): Promise<boolean> {
  const method = route.request().method();
  if (path.endsWith('/candidate/automation/rules') && method === 'PUT') {
    state.settings = {
      ...state.settings,
      rules: route.request().postDataJSON(),
      updatedAt: new Date().toISOString(),
    };
    await route.fulfill({ json: { data: { settings: state.settings } } });
    return true;
  }
  if (path.endsWith('/candidate/automation/pause') && method === 'POST') {
    const { days } = route.request().postDataJSON() as { days: number };
    const pausedUntil = new Date(Date.now() + days * 86_400_000).toISOString();
    state.settings = {
      ...state.settings,
      pausedUntil,
    };
    state.runtime = {
      ...state.runtime,
      status: 'paused',
      pauseUntil: pausedUntil,
      nextSendAt: pausedUntil,
    };
    await route.fulfill({ json: { data: { settings: state.settings } } });
    return true;
  }
  if (path.endsWith('/candidate/automation/pause') && method === 'DELETE') {
    state.settings = { ...state.settings, pausedUntil: null };
    state.runtime = {
      ...state.runtime,
      status: 'ready',
      emergencyPaused: false,
      pauseUntil: null,
      nextSendAt: new Date().toISOString(),
      consecutiveErrors: 0,
    };
    await route.fulfill({ json: { data: { settings: state.settings } } });
    return true;
  }
  const revoke = path.match(/\/candidate\/automation\/consents\/([^/]+)\/revoke$/u);
  if (!revoke || method !== 'POST') return false;
  const key = decodeURIComponent(revoke[1]!);
  state.consents = state.consents.map((consent) =>
    consent.key === key ? { ...consent, revokedAt: new Date().toISOString() } : consent,
  );
  state.settings = { ...state.settings, enabled: false };
  state.queue
    .filter((item) => item.status === 'approved')
    .forEach((item) => {
      item.status = 'pending_approval';
    });
  await route.fulfill({ json: { data: { revoked: true, ...automationState(state) } } });
  return true;
}

async function mockAutomationQueue(
  route: Route,
  path: string,
  url: URL,
  state: AutomationFixtureState,
): Promise<boolean> {
  const method = route.request().method();
  if (path.endsWith('/candidate/automation/queue/refresh') && method === 'POST') {
    const body = route.request().postDataJSON() as { opportunities?: unknown[] };
    await route.fulfill({
      json: { data: { added: 0, skipped: body.opportunities?.length ?? 0, items: [] } },
    });
    return true;
  }
  if (path.endsWith('/candidate/automation/queue/bulk') && method === 'POST') {
    return bulkAutomationQueue(route, state);
  }
  if (path.endsWith('/candidate/automation/queue') && method === 'GET') {
    if (state.queueBehavior.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, state.queueBehavior.delayMs));
    }
    if (state.queueBehavior.errorStatus) {
      await route.fulfill({
        status: state.queueBehavior.errorStatus,
        json: {
          error: {
            code: 'automation_queue_fixture_error',
            message: 'Не удалось загрузить очередь.',
          },
        },
      });
      return true;
    }
    const status = url.searchParams.get('status');
    const platform = url.searchParams.get('platform');
    const items = state.queue.filter(
      (item) =>
        (!status || item.status === status) && (!platform || item.payload.platform === platform),
    );
    await route.fulfill({
      json: {
        data: {
          items: items.map((item) => automationQueueSummary(item, state.settings.candidateId)),
          total: state.queueBehavior.totalOverride ?? items.length,
          limit: Number(url.searchParams.get('limit') ?? 20),
          offset: Number(url.searchParams.get('offset') ?? 0),
        },
      },
    });
    return true;
  }
  return mockAutomationQueueItem(route, path, state);
}

async function bulkAutomationQueue(route: Route, state: AutomationFixtureState): Promise<boolean> {
  const { filter, action } = route.request().postDataJSON() as {
    filter: { status: string; platform?: string };
    action: string;
  };
  const selected = state.queue.filter(
    (item) =>
      item.status === filter.status &&
      (!filter.platform || item.payload.platform === filter.platform),
  );
  selected.forEach((item) => applyAutomationAction(state, item, action));
  await route.fulfill({ json: { data: { matched: selected.length, updated: selected.length } } });
  return true;
}

async function mockAutomationQueueItem(
  route: Route,
  path: string,
  state: AutomationFixtureState,
): Promise<boolean> {
  const actionMatch = path.match(/\/candidate\/automation\/queue\/([^/]+)\/actions$/u);
  const letterMatch = path.match(/\/candidate\/automation\/queue\/([^/]+)\/letter$/u);
  const previewMatch = path.match(/\/candidate\/automation\/queue\/([^/]+)\/preview$/u);
  const match = actionMatch ?? letterMatch ?? previewMatch;
  if (!match) return false;
  const item = state.queue.find(
    (candidateItem) => candidateItem.id === decodeURIComponent(match[1]!),
  );
  if (!item) {
    await route.fulfill({
      status: 404,
      json: { error: { code: 'automation_queue_item_not_found' } },
    });
    return true;
  }
  if (actionMatch && route.request().method() === 'POST') {
    const { action } = route.request().postDataJSON() as { action: string };
    applyAutomationAction(state, item, action);
    await route.fulfill({
      json: {
        data: {
          item: automationQueueSummary(item, state.settings.candidateId),
          execution: item.status === 'approved' ? 'scheduled' : 'not_started',
        },
      },
    });
  } else if (letterMatch && route.request().method() === 'PATCH') {
    item.payload.letterText = (route.request().postDataJSON() as { letterText: string }).letterText;
    item.status = item.payload.letterText.trim() ? 'pending_approval' : 'letter_not_ready';
    await route.fulfill({
      json: { data: { item: automationQueueSummary(item, state.settings.candidateId) } },
    });
  } else {
    await route.fulfill({ json: { data: { id: item.id, status: item.status, ...item.payload } } });
  }
  return true;
}

async function mockAutomationStops(
  route: Route,
  path: string,
  state: AutomationFixtureState,
): Promise<boolean> {
  const method = route.request().method();
  if (
    path.endsWith('/candidate/automation/stop-companies/import-rejections') &&
    method === 'POST'
  ) {
    await route.fulfill({ json: { data: { imported: 0, stopCompanies: state.stops } } });
    return true;
  }
  if (!path.endsWith('/candidate/automation/stop-companies')) return false;
  if (method === 'GET') {
    await route.fulfill({ json: { data: { stopCompanies: state.stops } } });
    return true;
  }
  const { company } = route.request().postDataJSON() as { company: string };
  state.stops =
    method === 'POST'
      ? [
          ...state.stops.filter((item) => item.company !== company),
          { company, origin: 'manual', createdAt: new Date().toISOString() },
        ]
      : state.stops.filter((item) => item.company !== company);
  if (method === 'POST') {
    state.queue
      .filter(
        (item) =>
          item.payload.company === company &&
          ['letter_not_ready', 'pending_approval', 'approved'].includes(item.status),
      )
      .forEach((item) => {
        item.status = 'removed';
        item.payload = { ...item.payload, targetUrl: '', letterText: '', materials: [] };
      });
  }
  await route.fulfill({
    json: {
      data: { added: method === 'POST', removed: method === 'DELETE', stopCompanies: state.stops },
    },
  });
  return true;
}

async function mockAutomationApi(
  route: Route,
  path: string,
  url: URL,
  state: AutomationFixtureState,
): Promise<boolean> {
  if (!path.includes('/candidate/automation')) return false;
  return (
    (await mockAutomationConfiguration(route, path, state)) ||
    (await mockAutomationScheduler(route, path, url, state)) ||
    (await mockAutomationQueue(route, path, url, state)) ||
    (await mockAutomationStops(route, path, state))
  );
}

function createLinkedinDraftFixtureState(
  options: MockSignedInCabinetOptions,
): LinkedinDraftFixtureState {
  return {
    candidateId: options.candidateId ?? 'readability-candidate',
    drafts: [...(options.linkedinDrafts ?? [])],
    topics: [...(options.linkedinDraftTopics ?? [])],
    cadence: {
      timezone: 'Europe/Moscow',
      lastPublishedAt: null,
      nextAllowedAt: null,
      canPublish: true,
      ...options.linkedinDraftCadence,
    },
    nextDraftId: 1,
  };
}

async function mockLinkedinDraftApi(
  route: Route,
  path: string,
  url: URL,
  state: LinkedinDraftFixtureState,
): Promise<boolean> {
  const method = route.request().method();
  if (path.endsWith('/candidate/drafts/topics') && method === 'GET') {
    const limit = Number(url.searchParams.get('limit') ?? 3);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    return route
      .fulfill({
        json: {
          data: {
            items: state.topics.slice(offset, offset + limit),
            total: state.topics.length,
            cadence: state.cadence,
          },
        },
      })
      .then(() => true);
  }
  const dismissMatch = path.match(/\/candidate\/drafts\/topics\/([^/]+)\/dismiss$/u);
  if (dismissMatch && method === 'POST') {
    const id = decodeURIComponent(dismissMatch[1]);
    state.topics = state.topics.filter((topic) => topic.id !== id);
    await route.fulfill({ json: { data: { id, decision: 'dismissed' } } });
    return true;
  }
  if (path.endsWith('/candidate/drafts') && method === 'GET') {
    const limit = Number(url.searchParams.get('limit') ?? 20);
    await route.fulfill({ json: { data: state.drafts.slice(0, limit) } });
    return true;
  }
  if (path.endsWith('/candidate/drafts') && method === 'POST') {
    const input = route.request().postDataJSON() as Record<string, unknown>;
    const draft = {
      id: `draft-fixture-${state.nextDraftId++}`,
      candidateId: state.candidateId,
      kind: input.kind,
      topic: input.topic,
      text: `Черновик по теме «${String(input.topic)}».`,
      status: 'draft',
      localDate: '2026-10-10',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    state.drafts = [draft, ...state.drafts];
    if (typeof input.topicId === 'string')
      state.topics = state.topics.filter((topic) => topic.id !== input.topicId);
    await route.fulfill({ json: { data: draft } });
    return true;
  }
  const draftMatch = path.match(/\/candidate\/drafts\/([^/]+)$/u);
  if (draftMatch && method === 'PATCH') {
    const id = decodeURIComponent(draftMatch[1]);
    const index = state.drafts.findIndex((draft) => draft.id === id);
    if (index < 0) {
      await route.fulfill({
        status: 404,
        json: { error: { code: 'draft_not_found', message: 'Черновик не найден.' } },
      });
      return true;
    }
    const update = route.request().postDataJSON() as Record<string, unknown>;
    const existing = state.drafts[index];
    const changed: Record<string, unknown> = {
      ...existing,
      ...update,
      updatedAt: new Date().toISOString(),
    };
    if (update.text) changed.status = 'draft';
    if (update.status === 'published') {
      changed.publishedAt = changed.updatedAt;
      state.cadence = {
        ...state.cadence,
        lastPublishedAt: String(changed.publishedAt),
        nextAllowedAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        canPublish: false,
      };
    }
    state.drafts = state.drafts.map((draft, draftIndex) =>
      draftIndex === index ? changed : draft,
    );
    await route.fulfill({ json: { data: changed } });
    return true;
  }
  return false;
}

export async function mockSignedInCabinet(
  page: Page,
  options: MockSignedInCabinetOptions = {},
): Promise<string[]> {
  const unmatched: string[] = [];
  // Fixtures carry fixed calendar dates; specs whose assertions compare them with "now"
  // opt in to a frozen clock so a run on a later day does not drift out of their windows.
  if (options.freezeNow) await page.clock.setFixedTime(FIXTURE_NOW);
  let accountState = {
    ...account,
    profile: { ...account.profile },
    sessions: account.sessions.map((session) => ({ ...session })),
  };
  let pendingEmailChange: { email: string; expiresAt: string; resendAfterSeconds: number } | null =
    null;
  let billingCurrentPlan: FixtureCurrentPlan = options.billing?.initialPlan ?? 'basic';
  let billingAutoRenew = options.billing?.autoRenew ?? billingCurrentPlan !== 'free';
  let billingPeriodEnd = '2026-11-08T00:00:00.000Z';
  let currentInvoice: FixtureInvoice | null = null;
  let checkoutStatusIndex = 0;
  const executiveRequest = {
    id: 'b070e908-b525-4fb9-9aa4-3b289d5d190b',
    task: '',
    timeline: '',
    status: options.billing?.executiveStatus ?? 'waitlisted',
    profileSharingConsent: true,
    profileSharingConsentAt: '2026-10-11T12:00:00.000Z',
    profileSharingConsentVersion: 'executive-profile-sharing-v1',
    createdAt: '2026-10-11T12:00:00.000Z',
    updatedAt: '2026-10-11T12:00:00.000Z',
  };
  let storedExecutiveRequest: typeof executiveRequest | null = null;
  let receiptRows: FixtureReceipt[] =
    billingCurrentPlan === 'free'
      ? []
      : [
          {
            invoiceId: 41,
            planId: billingCurrentPlan,
            amountKopecks:
              billingCurrentPlan === 'basic'
                ? 399000
                : billingCurrentPlan === 'pro'
                  ? 990000
                  : 3990000,
            currency: 'RUB' as const,
            paidAt: '2026-10-10T10:00:00.000Z',
            paymentMethod: null,
            receiptUrl: null,
            receiptStatus: 'not-provided',
            fiscalDocumentNumber: null,
            fiscalDate: null,
          },
        ];
  let applications = savedApplicationFixtures(options.savedVacanciesCount ?? 0);
  let nextApplicationId = 1;
  const connectionState = createMockConnectionState();

  type MockConnectionContact = Record<string, unknown> & {
    readonly id: string;
    readonly createdAt: string;
    readonly updatedAt: string;
  };

  type MockConnectionState = {
    readonly contacts: Map<string, MockConnectionContact>;
    importReceipt: {
      state: 'unknown' | 'imported';
      importedAt: string | null;
      importedCount: number | null;
    };
  };

  function createMockConnectionState(): MockConnectionState {
    return {
      contacts: new Map(),
      importReceipt: { state: 'unknown', importedAt: null, importedCount: null },
    };
  }

  async function mockConnectionRoutes(
    route: Route,
    url: URL,
    state: MockConnectionState,
  ): Promise<boolean> {
    const path = url.pathname;
    if (path === '/api/v1/candidate/connection-contacts') {
      return mockConnectionContactList(route, url, state);
    }
    if (path === '/api/v1/candidate/connection-contacts/linkedin-import') {
      return mockConnectionImport(route, state);
    }
    const contact = path.match(/^\/api\/v1\/candidate\/connection-contacts\/([^/]+)$/u);
    if (contact) return mockConnectionMutation(route, decodeURIComponent(contact[1]!), state);
    const circles = path.match(/^\/api\/v1\/candidate\/vacancies\/([^/]+)\/connection-circles$/u);
    if (circles) return mockConnectionCircles(route, decodeURIComponent(circles[1]!), state);
    return false;
  }

  async function mockConnectionContactList(
    route: Route,
    url: URL,
    state: MockConnectionState,
  ): Promise<boolean> {
    if (route.request().method() !== 'GET') return false;
    const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0));
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));
    const contacts = Array.from(state.contacts.values());
    const items = contacts.slice(offset, offset + limit);
    return route
      .fulfill({
        json: {
          data: {
            items,
            total: contacts.length,
            offset,
            limit,
            nextOffset: offset + items.length < contacts.length ? offset + items.length : null,
            linkedinImport: state.importReceipt,
          },
        },
      })
      .then(() => true);
  }

  async function mockConnectionImport(route: Route, state: MockConnectionState): Promise<boolean> {
    if (route.request().method() !== 'PUT') return false;
    const body = route.request().postDataJSON() as { contacts?: Array<Record<string, unknown>> };
    const importedAt = '2026-10-10T12:00:00.000Z';
    for (const [id, contact] of state.contacts) {
      if (contact.source === 'linkedin_import') state.contacts.delete(id);
    }
    for (const [index, contact] of (body.contacts ?? []).entries()) {
      const id = String(contact.externalId ?? contact.linkedinUrl ?? `imported-${index + 1}`);
      state.contacts.set(id, {
        ...contact,
        id,
        source: 'linkedin_import',
        createdAt: importedAt,
        updatedAt: importedAt,
      });
    }
    state.importReceipt = {
      state: 'imported',
      importedAt,
      importedCount: (body.contacts ?? []).length,
    };
    return route.fulfill({ json: { data: state.importReceipt } }).then(() => true);
  }

  async function mockConnectionMutation(
    route: Route,
    id: string,
    state: MockConnectionState,
  ): Promise<boolean> {
    if (route.request().method() === 'DELETE') {
      const contact = state.contacts.get(id);
      if (contact?.source === 'linkedin_import') {
        await route.fulfill({
          status: 409,
          json: { error: { code: 'connection_contact_read_only' } },
        });
        return true;
      }
      if (contact?.source === 'manual') state.contacts.delete(id);
      await route.fulfill({ status: 204 });
      return true;
    }
    if (route.request().method() !== 'PUT') return false;
    const previous = state.contacts.get(id);
    const now = '2026-10-10T12:00:00.000Z';
    const contact = {
      ...(route.request().postDataJSON() as Record<string, unknown>),
      id,
      source: 'manual',
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    state.contacts.set(id, contact);
    await route.fulfill({ status: previous ? 200 : 201, json: { data: contact } });
    return true;
  }

  async function mockConnectionCircles(
    route: Route,
    vacancyId: string,
    state: MockConnectionState,
  ): Promise<boolean> {
    if (route.request().method() !== 'GET') return false;
    const knownState = state.importReceipt.state === 'imported' ? 'none' : 'unknown';
    await route.fulfill({
      json: {
        data: {
          vacancyId,
          companyKey: 'fincloud',
          companyName: 'FinCloud',
          vacancyTitle: 'Head of Product, Payments',
          circles: [
            {
              circle: 1,
              state: knownState,
              message: 'Связи в компании пока не найдены.',
              paths: [],
            },
            {
              circle: 2,
              state: knownState,
              message: 'Можно попросить представить через знакомого.',
              paths: [],
            },
            {
              circle: 3,
              state: 'available',
              message: 'Подготовьте холодный отклик по вакансии.',
              paths: [
                {
                  id: 'cold-application',
                  circle: 3,
                  recipient: {
                    id: 'fincloud-recruiting-team',
                    fullName: 'Команда найма',
                    roleTitle: null,
                    companyName: 'FinCloud',
                  },
                  path: [],
                  evidence: [],
                  strength: 'unknown',
                  source: 'cold',
                  nextStep: 'cold_application',
                },
              ],
            },
          ],
          linkedinImport: state.importReceipt,
        },
      },
    });
    return true;
  }

  const applicationLabels: Array<{ id: string; name: string; createdAt: string }> = [];
  const companyWants: Array<{
    companyKey: string;
    companyName: string;
    nextStep: string | null;
    nextStepDueAt: string | null;
    updatedAt: string;
  }> = [];
  const applicationOperationResults = new Map<
    string,
    { fingerprint: string; result: Record<string, unknown> }
  >();
  let decisionProfile: Record<string, unknown> | null = null;
  let skillQuizCommandId: string | null = null;
  let skillQuizReverted = false;
  const careerDiary = options.careerDiary ? structuredClone(options.careerDiary) : undefined;
  const assessmentFixture = createRoleSkillAssessmentFixture(options);
  const starStoriesFixture = createMockStarStoriesFixture();
  const profileSnapshot = mockProfileSnapshot(careerDiary);
  const automation = createAutomationFixtureState(options);
  const linkedinDrafts = createLinkedinDraftFixtureState(options);
  const relocationConsent = {
    status: options.relocation?.consentGranted ? 'granted' : 'not_granted',
    granted: options.relocation?.consentGranted ?? false,
    versionId: options.relocation?.consentGranted
      ? RELOCATION_CONSENT_VERSION
      : (null as string | null),
    grantedAt: options.relocation?.consentGranted
      ? '2026-10-10T12:00:00.000Z'
      : (null as string | null),
    revokedAt: null as string | null,
  };
  let relocationProfile: Record<string, unknown> | null = options.relocation?.consentGranted
    ? {
        ...emptyRelocationProfile(),
        currentStep: options.relocation.currentStep ?? 'citizenship_documents',
        citizenshipDocuments: {
          citizenshipCountryCodes: [...(options.relocation.citizenshipCountryCodes ?? [])],
          documents: [...(options.relocation.documents ?? [])],
        },
      }
    : null;
  let todayDecisionSelection:
    import('../../shared/todayDecision').TodayDecisionSelection | undefined;
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (await mockCandidateNotificationRoutes(route, path, options)) return;
    if (await mockLineCRoutes(route, path, options, assessmentFixture, starStoriesFixture)) return;
    if (await mockCareerDiaryRoutes(route, path, careerDiary)) return;
    if (await mockConnectionRoutes(route, url, connectionState)) return;
    if (
      route.request().method() === 'POST' &&
      /\/api\/v1\/candidate\/vacancies\/[^/]+\/letter-approvals$/u.test(path)
    ) {
      return route.fulfill({
        status: 200,
        json: {
          data: {
            applicationId: 'application-b449-approved',
            documentId: 'document-b449-letter',
            approvedAt: '2026-10-10T12:00:00.000Z',
            status: 'approved',
            sent: false,
          },
        },
      });
    }
    if (path.endsWith('/auth/me')) {
      return route.fulfill({ json: { data: { ...candidate, emailVerified: true } } });
    }
    if (path.endsWith('/candidate/workspace')) {
      return route.fulfill({ json: { data: workspace } });
    }
    if (path === '/api/v1/candidate/billing/trial' && route.request().method() === 'GET') {
      return route.fulfill({
        json: {
          data: {
            status: 'unavailable',
            startedAt: null,
            expiresAt: null,
            serverNow: new Date().toISOString(),
          },
        },
      });
    }
    if (path === '/api/v1/candidate/billing' && route.request().method() === 'GET') {
      const currentPlan =
        currentInvoice?.status === 'paid' ? currentInvoice.planId : billingCurrentPlan;
      const subscription =
        currentPlan === 'free'
          ? null
          : {
              status: options.billing?.subscriptionStatus ?? 'active',
              currentPeriodEndsAt: billingPeriodEnd,
              nextChargeAt: billingAutoRenew ? billingPeriodEnd : null,
              autoRenew: billingAutoRenew,
            };
      return route.fulfill({
        json: {
          data: {
            currentPlan,
            subscription,
            plans: [
              {
                id: 'basic',
                name: 'Basic',
                amountKopecks: 399000,
                currency: 'RUB',
                interval: 'month',
              },
              { id: 'pro', name: 'Pro', amountKopecks: 990000, currency: 'RUB', interval: 'month' },
              {
                id: 'max',
                name: 'Max',
                amountKopecks: 3990000,
                currency: 'RUB',
                interval: 'month',
              },
            ],
          },
        },
      });
    }
    if (path === '/api/v1/candidate/billing/checkouts' && route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as {
        planId?: FixturePaidPlan;
        autoRenew?: boolean;
      };
      const amounts: Record<FixturePaidPlan, number> = { basic: 399000, pro: 990000, max: 3990000 };
      const key = route.request().headers()['idempotency-key'] ?? 'fixture-idempotency-key';
      if (!body.planId || !(body.planId in amounts)) {
        return route.fulfill({
          status: 400,
          json: { error: { code: 'billing_checkout_invalid' } },
        });
      }
      if (!currentInvoice || currentInvoice.idempotencyKey !== key) {
        currentInvoice = {
          invoiceId: 731,
          planId: body.planId,
          amountKopecks: amounts[body.planId],
          currency: 'RUB',
          status: 'pending',
          autoRenew: body.autoRenew === true,
          paymentUrl: 'https://auth.robokassa.ru/Merchant/Index?InvoiceID=731',
          createdAt: '2026-10-11T12:00:00.000Z',
          idempotencyKey: key,
        };
      }
      return route.fulfill({
        status: 201,
        headers: { location: '/api/v1/candidate/billing/checkouts/731' },
        json: { data: checkoutResponse(currentInvoice) },
      });
    }
    if (path === '/api/v1/candidate/billing/checkouts/731' && route.request().method() === 'GET') {
      if (!currentInvoice)
        return route.fulfill({
          status: 404,
          json: { error: { code: 'billing_checkout_not_found' } },
        });
      const statuses = options.billing?.checkoutStatuses ?? ['pending'];
      const status = statuses[Math.min(checkoutStatusIndex, statuses.length - 1)] ?? 'pending';
      checkoutStatusIndex += 1;
      currentInvoice = { ...currentInvoice, status };
      if (status === 'paid') {
        billingCurrentPlan = currentInvoice.planId;
        billingAutoRenew = currentInvoice.autoRenew;
        billingPeriodEnd = '2026-11-11T00:00:00.000Z';
        if (!receiptRows.some((receipt) => receipt.invoiceId === currentInvoice?.invoiceId)) {
          receiptRows = [
            ...receiptRows,
            {
              invoiceId: currentInvoice.invoiceId,
              planId: currentInvoice.planId,
              amountKopecks: currentInvoice.amountKopecks,
              currency: 'RUB',
              paidAt: '2026-10-11T12:05:00.000Z',
              paymentMethod: null,
              receiptUrl: null,
              receiptStatus: 'not-provided',
              fiscalDocumentNumber: null,
              fiscalDate: null,
            },
          ];
        }
      }
      return route.fulfill({ json: { data: checkoutResponse(currentInvoice) } });
    }
    if (path === '/api/v1/candidate/billing/receipts' && route.request().method() === 'GET') {
      return route.fulfill({
        json: {
          data: receiptRows,
          meta: { nextCursor: null },
        },
      });
    }
    if (
      path === '/api/v1/candidate/billing/subscription/cancel-renewal' &&
      route.request().method() === 'POST'
    ) {
      billingAutoRenew = false;
      return route.fulfill({
        json: {
          data: {
            planId: billingCurrentPlan === 'free' ? 'basic' : billingCurrentPlan,
            status: 'active',
            currentPeriodEndsAt: billingPeriodEnd,
            nextChargeAt: null,
            autoRenew: false,
            cancellationEventId: 'fixture-cancellation-event',
          },
        },
      });
    }
    if (path === '/api/v1/candidate/executive-requests' && route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as {
        task?: string;
        timeline?: string;
        profileSharingConsent?: boolean;
      };
      if (body.profileSharingConsent !== true) {
        return route.fulfill({
          status: 400,
          json: { error: { code: 'executive_request_invalid' } },
        });
      }
      const replayed = storedExecutiveRequest !== null;
      storedExecutiveRequest = {
        ...executiveRequest,
        task: body.task ?? '',
        timeline: body.timeline ?? '',
      };
      return route.fulfill({
        status: replayed ? 200 : 201,
        json: { data: storedExecutiveRequest, meta: { requestId: 'fixture-request' } },
      });
    }
    if (path === '/api/v1/candidate/executive-requests' && route.request().method() === 'GET') {
      return route.fulfill({
        json: {
          data: { items: storedExecutiveRequest ? [storedExecutiveRequest] : [], nextCursor: null },
        },
      });
    }
    if (path.endsWith('/candidate/today/decision') && route.request().method() === 'POST') {
      const input = route.request().postDataJSON();
      todayDecisionSelection = {
        applicationId: input.applicationId,
        resolution: input.resolution,
        updatedAt: new Date().toISOString(),
      };
      return route.fulfill({ json: { data: todayDecisionSelection } });
    }
    if (path.endsWith('/candidate/today')) {
      const existingMomentum =
        'momentum' in todaySnapshot
          ? (todaySnapshot as { momentum?: unknown }).momentum
          : undefined;
      const snapshotWithMomentum = {
        ...todaySnapshot,
        todayDecisionSelection,
        momentum: existingMomentum ?? {
          calculatedAt: '2026-10-09T12:00:00.000Z',
          windows: {
            '7d': { applied: 4, views: 'unknown', screenings: 'unknown', interviews: 1 },
            '30d': { applied: 14, views: 'unknown', screenings: 'unknown', interviews: 2 },
          },
          burnoutNotice: false,
        },
      };
      return route.fulfill({ json: { data: snapshotWithMomentum } });
    }
    // B542: контакт отклика (имя человека для напоминания); в фикстуре контакта нет.
    if (/^\/api\/v1\/candidate\/applications\/[^/]+\/contact$/u.test(path)) {
      const method = route.request().method();
      const body = method === 'GET' ? null : (route.request().postDataJSON() as unknown);
      return route.fulfill({ json: { data: method === 'DELETE' ? null : body } });
    }
    // B422: «Хочу» по названию компании, которой ещё нет в списке кандидата.
    if (path === '/api/v1/candidate/company-wants' && route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as { companyName?: string };
      return route.fulfill({
        json: {
          data: { key: 'f'.repeat(24), name: body.companyName ?? '', want: true, nextStep: null },
        },
      });
    }
    if (path === '/api/v1/candidate/saved-vacancy-states' && route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { items?: { clusterId: string }[] };
      const ids = (body.items ?? []).map((item) => item.clusterId);
      return route.fulfill({ json: { data: savedVacancyStateFixtures(ids) } });
    }
    // Saved vacancies use the same candidate application tracker as the Responses screen.
    if (path === '/api/v1/candidate/applications') {
      if (route.request().method() === 'GET')
        return route.fulfill({ json: { data: applications } });
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON() as {
          clusterId?: string;
          stage?: string;
          manualVacancy?: unknown;
        };
        const timestamp = '2026-10-10T00:00:00.000Z';
        const created: ApplicationStub = {
          id: `application-${nextApplicationId++}`,
          candidateId: 'candidate-fixture',
          clusterId: body.clusterId ?? null,
          stage: body.stage ?? 'saved',
          archivePreviousStage: null,
          version: 1,
          vacancy: body.manualVacancy ?? null,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        applications = [...applications, created];
        return route.fulfill({ status: 201, json: { data: created } });
      }
    }
    const applicationRoute = path.match(
      /^\/api\/v1\/candidate\/applications\/([^/]+)(\/restore)?$/u,
    );
    if (applicationRoute && route.request().method() === 'PATCH') {
      const record = applications.find(
        (item) => item.id === decodeURIComponent(applicationRoute[1]!),
      );
      if (!record) return route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
      const body = route.request().postDataJSON() as { stage?: string };
      if (body.stage === 'archived') record.archivePreviousStage = record.stage;
      if (body.stage) record.stage = body.stage;
      record.version += 1;
      record.updatedAt = '2026-10-10T00:01:00.000Z';
      return route.fulfill({ json: { data: record } });
    }
    if (
      applicationRoute &&
      route.request().method() === 'POST' &&
      applicationRoute[2] === '/restore'
    ) {
      const record = applications.find(
        (item) => item.id === decodeURIComponent(applicationRoute[1]!),
      );
      if (!record) return route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
      record.stage = record.archivePreviousStage ?? 'saved';
      record.archivePreviousStage = null;
      record.version += 1;
      record.updatedAt = '2026-10-10T00:02:00.000Z';
      return route.fulfill({ json: { data: record } });
    }
    if (path.endsWith('/candidate/application-labels')) {
      if (route.request().method() === 'POST') {
        const name = String(route.request().postDataJSON().name ?? '')
          .trim()
          .replace(/\s+/gu, ' ');
        const existing = applicationLabels.find(
          (label) => label.name.toLocaleLowerCase('und') === name.toLocaleLowerCase('und'),
        );
        const label = existing ?? {
          id: `mock-label-${applicationLabels.length + 1}`,
          name,
          createdAt: new Date().toISOString(),
        };
        if (!existing) applicationLabels.push(label);
        return route.fulfill({ status: existing ? 200 : 201, json: { data: label } });
      }
      return route.fulfill({ json: { data: applicationLabels } });
    }
    if (path.endsWith('/candidate/applications/company-wants/bulk/preview')) {
      const body = route.request().postDataJSON();
      const wanted = new Set(
        companyWants.map((company) => company.companyName.toLocaleLowerCase('und')),
      );
      const companies = Array.isArray(body.companies)
        ? (body.companies as Array<{ companyName: string }>)
        : [];
      const affectedCount = companies.filter((company) =>
        body.action === 'add'
          ? !wanted.has(company.companyName.toLocaleLowerCase('und'))
          : wanted.has(company.companyName.toLocaleLowerCase('und')),
      ).length;
      return route.fulfill({ json: { data: { affectedCount } } });
    }
    if (path.endsWith('/candidate/applications/company-wants/bulk')) {
      const body = route.request().postDataJSON();
      const replay = applicationOperationResults.get(String(body.operationId));
      const fingerprint = JSON.stringify({
        action: body.action,
        companies: body.companies,
        confirmCount: body.confirmCount,
      });
      if (replay) {
        if (replay.fingerprint !== fingerprint)
          return route.fulfill({
            status: 409,
            json: { error: { code: 'idempotency_key_reused' } },
          });
        return route.fulfill({ json: { data: { ...replay.result, replayed: true } } });
      }
      const companies = Array.isArray(body.companies)
        ? (body.companies as Array<Record<string, unknown>>)
        : [];
      const keys = new Set(
        companyWants.map((company) => company.companyName.toLocaleLowerCase('und')),
      );
      const targets = companies.filter((company) => {
        const exists = keys.has(String(company.companyName).toLocaleLowerCase('und'));
        return body.action === 'add' ? !exists : exists;
      });
      if (Number(body.confirmCount) !== targets.length) {
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: 'bulk_confirmation_count_changed',
              details: { affectedCount: targets.length },
            },
          },
        });
      }
      for (const company of targets)
        applyMockCompanyWant(companyWants, company, String(body.action));
      const result = { state: 'completed', changedCount: targets.length };
      applicationOperationResults.set(String(body.operationId), { fingerprint, result });
      return route.fulfill({ json: { data: { ...result, replayed: false } } });
    }
    if (path.endsWith('/candidate/applications/company-wants')) {
      return route.fulfill({ json: { data: companyWants } });
    }
    if (path.endsWith('/candidate/applications/bulk/preview')) {
      return route.fulfill({ json: { data: { affectedCount: 0 } } });
    }
    if (path.endsWith('/candidate/applications/bulk')) {
      const body = route.request().postDataJSON();
      const fingerprint = JSON.stringify({
        filters: body.filters,
        action: body.action,
        confirmCount: body.confirmCount,
      });
      const replay = applicationOperationResults.get(String(body.operationId));
      if (replay) {
        if (replay.fingerprint !== fingerprint)
          return route.fulfill({
            status: 409,
            json: { error: { code: 'idempotency_key_reused' } },
          });
        return route.fulfill({ json: { data: { ...replay.result, replayed: true } } });
      }
      if (Number(body.confirmCount) !== 0) {
        return route.fulfill({
          status: 409,
          json: {
            error: { code: 'bulk_confirmation_count_changed', details: { affectedCount: 0 } },
          },
        });
      }
      const result =
        body.action?.type === 'retry'
          ? { state: 'prepared', preparedCount: 0, sentCount: 0, changedCount: 0 }
          : { state: 'completed', changedCount: 0 };
      applicationOperationResults.set(String(body.operationId), { fingerprint, result });
      return route.fulfill({ json: { data: { ...result, replayed: false } } });
    }
    if (/\/candidate\/applications\/[^/]+\/labels\/[^/]+$/u.test(path)) {
      return route.fulfill({ status: 404, json: { error: { code: 'application_not_found' } } });
    }
    if (await mockLinkedinDraftApi(route, path, url, linkedinDrafts)) return;
    // The readability fixture has no tracked applications yet; an empty
    // list is the honest state, not an unknown route.
    if (path.endsWith('/candidate/drafts')) {
      return route.fulfill({ json: { data: [] } });
    }
    if (await mockAutomationApi(route, path, url, automation)) return;
    // B370: панель отправки откликов читает лимиты и квитанции; в фикстуре действий нет.
    if (path.endsWith('/candidate/actions/usage')) {
      return route.fulfill({
        json: {
          data: {
            usage: {
              localDate: '2026-10-01',
              hhAppliesCount: 0,
              linkedinEasyAppliesCount: 0,
              hhBoostsCount: 0,
              lastHhBoostAt: null,
            },
            timezone: 'Europe/Moscow',
            resetAt: '2026-10-01T21:00:00.000Z',
            killSwitchActive: false,
            limits: {
              maxHhAppliesPerDay: 15,
              maxLinkedinEasyAppliesPerDay: 10,
              maxHhBoostsPerDay: 3,
              minHhBoostIntervalMinutes: 240,
            },
          },
        },
      });
    }
    if (path.endsWith('/me/consents/actions_on_behalf')) {
      return route.fulfill({
        json: { data: { capability: 'actions_on_behalf', granted: false, consent: null } },
      });
    }
    if (path.endsWith('/candidate/actions/receipts')) {
      return route.fulfill({ json: { data: { receipts: [] } } });
    }
    // C64: шапка Профиля читает согласие «Вы в поиске»; в фикстуре оно не дано.
    if (path.endsWith('/candidate/search-consent')) {
      return route.fulfill({
        json: { data: { consent: { granted: false, policyVersion: '', updatedAt: '' } } },
      });
    }
    if (path.endsWith('/candidate/decision-profile')) {
      if (route.request().method() === 'PUT') {
        decisionProfile = {
          ...route.request().postDataJSON(),
          updatedAt: '2026-10-06T12:00:00.000Z',
        };
      }
      return route.fulfill({ json: { data: decisionProfile } });
    }
    if (path.endsWith('/candidate/relocation-questionnaire/consent')) {
      if (route.request().method() === 'PUT') {
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: 'relocation_consent_text_not_approved',
              message: 'Текст согласия ожидает проверки и пока не может быть принят.',
            },
          },
        });
      }
      if (route.request().method() === 'DELETE') {
        const revoked = relocationConsent.granted;
        relocationConsent.status = 'revoked';
        relocationConsent.granted = false;
        relocationConsent.revokedAt = '2026-10-10T12:00:00.000Z';
        relocationProfile = null;
        return route.fulfill({
          json: { data: { consent: relocationConsent, revoked, deleted: true } },
        });
      }
    }
    if (path.endsWith('/candidate/relocation-questionnaire/languages/linkedin')) {
      return route.fulfill({
        status: 409,
        json: {
          error: {
            code: 'linkedin_languages_unavailable',
            message: 'Импортированный профиль не содержит языков.',
          },
        },
      });
    }
    if (
      path.endsWith('/candidate/relocation-questionnaire/progress') &&
      route.request().method() === 'PUT'
    ) {
      if (!relocationConsent.granted)
        return route.fulfill({
          status: 409,
          json: { error: { code: 'relocation_consent_required' } },
        });
      const profile = relocationProfile ?? emptyRelocationProfile();
      const revision = profile.revision as number;
      if (route.request().headers()['if-match'] !== `"${revision}"`)
        return route.fulfill({
          status: 412,
          json: {
            error: {
              code: 'relocation_profile_revision_conflict',
              details: { currentRevision: revision },
            },
          },
        });
      relocationProfile = {
        ...profile,
        ...route.request().postDataJSON(),
        revision: revision + 1,
        updatedAt: '2026-10-10T12:00:00.000Z',
      };
      return route.fulfill({
        headers: { etag: `"${revision + 1}"` },
        json: {
          data: {
            profile: relocationProfile,
            alerts: buildFixtureRelocationAlerts(relocationProfile, relocationConsent.granted),
          },
        },
      });
    }
    const relocationStep = path.match(/\/candidate\/relocation-questionnaire\/steps\/([^/]+)$/u);
    if (relocationStep && route.request().method() === 'PUT') {
      if (!relocationConsent.granted)
        return route.fulfill({
          status: 409,
          json: { error: { code: 'relocation_consent_required' } },
        });
      const stepFields: Readonly<Record<string, string>> = {
        citizenship_documents: 'citizenshipDocuments',
        education: 'education',
        family: 'family',
        languages: 'languages',
      };
      const step = decodeURIComponent(relocationStep[1]!);
      const field = stepFields[step];
      if (!field)
        return route.fulfill({ status: 404, json: { error: { code: 'unknown_relocation_step' } } });
      const profile = relocationProfile ?? emptyRelocationProfile();
      const revision = profile.revision as number;
      if (route.request().headers()['if-match'] !== `"${revision}"`)
        return route.fulfill({
          status: 412,
          json: {
            error: {
              code: 'relocation_profile_revision_conflict',
              details: { currentRevision: revision },
            },
          },
        });
      relocationProfile = {
        ...profile,
        [field]: route.request().postDataJSON(),
        revision: revision + 1,
        updatedAt: '2026-10-10T12:00:00.000Z',
      };
      return route.fulfill({
        headers: { etag: `"${revision + 1}"` },
        json: {
          data: {
            profile: relocationProfile,
            alerts: buildFixtureRelocationAlerts(relocationProfile, relocationConsent.granted),
          },
        },
      });
    }
    if (path.endsWith('/candidate/relocation-scenarios') && route.request().method() === 'GET') {
      return route.fulfill({ json: { data: { items: [], nextOffset: null } } });
    }
    if (
      path.endsWith('/candidate/relocation-questionnaire') &&
      route.request().method() === 'GET'
    ) {
      return route.fulfill({
        headers: relocationConsent.granted
          ? { etag: `"${(relocationProfile?.revision as number | undefined) ?? 0}"` }
          : {},
        json: {
          data: {
            profile: relocationConsent.granted
              ? (relocationProfile ?? emptyRelocationProfile())
              : null,
            consent: relocationConsent,
            consentTextStatus: 'pending_dpo_review',
            alerts: buildFixtureRelocationAlerts(relocationProfile, relocationConsent.granted),
          },
        },
      });
    }
    if (
      path.endsWith('/candidate/relocation-questionnaire') &&
      route.request().method() === 'DELETE'
    ) {
      relocationProfile = null;
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith('/candidate/skill-quiz/apply') && route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      skillQuizCommandId = route.request().headers()['idempotency-key'] ?? 'skill-quiz-command';
      skillQuizReverted = false;
      await new Promise((resolve) => setTimeout(resolve, 150));
      const skillName = String(body.skillName ?? 'TypeScript');
      return route.fulfill({
        status: 201,
        json: {
          data: {
            commandId: skillQuizCommandId,
            command: { commandId: skillQuizCommandId },
            result: { quizId: body.quizId, statusLabel: 'подтверждён' },
            fact: {
              skillName,
              status: 'подтверждён',
              source: 'hh.ru',
              date: '2026-10-06',
              scorePercent: 100,
              statement: `${skillName}: подтверждён (hh.ru, 2026-10-06, 100%)`,
            },
          },
        },
      });
    }
    const skillQuizRevert = path.match(/\/candidate\/career-commands\/([^/]+)\/revert$/u);
    if (skillQuizRevert && route.request().method() === 'POST') {
      const commandId = decodeURIComponent(skillQuizRevert[1]!);
      if (commandId !== skillQuizCommandId) {
        return route.fulfill({
          status: 404,
          json: { error: { code: 'career_command_not_found', message: 'Команда не найдена.' } },
        });
      }
      if (skillQuizReverted) {
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: 'profile_revision_already_reverted',
              message: 'Это изменение уже отменено',
            },
          },
        });
      }
      skillQuizReverted = true;
      return route.fulfill({ json: { data: { commandId, profileRevisionReverted: true } } });
    }
    if (path.endsWith('/candidate/footprint/plan')) {
      return route.fulfill({
        json: {
          data: {
            plan: [],
            sourceAvailability: {
              sherlock: true,
              maigret: true,
              hibp: false,
              wayback: true,
              exa: false,
            },
            consent: {
              approved: false,
              granted: false,
              versionId: 'digital_footprint-v1.1',
            },
            audit: null,
          },
        },
      });
    }
    if (path.endsWith('/candidate/resume/ats-assessment')) {
      return route.fulfill({ json: { data: { assessment: null } } });
    }
    if (path.endsWith('/candidate/resume/versions') && route.request().method() === 'GET') {
      return route.fulfill({
        json: {
          data: {
            items: [],
            nextCursor: null,
            totalCount: 0,
            currentMasterRevision: 'mock-master-1',
          },
        },
      });
    }
    if (path.endsWith('/candidate/footprint')) {
      return route.fulfill({ json: { data: { audit: null } } });
    }
    if (path.endsWith('/candidate/visits') && route.request().method() === 'POST') {
      return route.fulfill({ json: { data: { since: null } } });
    }
    if (path.endsWith('/candidate/me')) {
      return route.fulfill({
        json: {
          data: profileSnapshot,
          meta: { memory: { nextOffset: null }, turns: { nextOffset: null } },
        },
      });
    }
    const sessionMatch = path.match(/\/account\/sessions\/([0-9a-f]{16})$/u);
    if (sessionMatch && route.request().method() === 'DELETE') {
      accountState.sessions = accountState.sessions.filter(
        (session) => session.id !== sessionMatch[1] || session.current,
      );
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith('/account/sessions') && route.request().method() === 'DELETE') {
      const before = accountState.sessions.length;
      accountState.sessions = accountState.sessions.filter((session) => session.current);
      return route.fulfill({ json: { data: { revoked: before - accountState.sessions.length } } });
    }
    if (path.endsWith('/account/profile') && route.request().method() === 'PATCH') {
      const patch = route.request().postDataJSON() as Record<string, unknown>;
      accountState = {
        ...accountState,
        ...(typeof patch.displayName === 'string' ? { displayName: patch.displayName } : {}),
        profile: { ...accountState.profile, ...patch },
      };
      return route.fulfill({ json: { data: accountState } });
    }
    if (path.endsWith('/account/password') && route.request().method() === 'POST') {
      return route.fulfill({ json: { data: candidate } });
    }
    if (
      path.endsWith('/account/email-change-requests/current') &&
      route.request().method() === 'GET'
    ) {
      return route.fulfill({ json: { data: pendingEmailChange } });
    }
    if (
      path.endsWith('/account/email-change-requests/current/verification') &&
      route.request().method() === 'POST'
    ) {
      if (pendingEmailChange) accountState = { ...accountState, email: pendingEmailChange.email };
      pendingEmailChange = null;
      return route.fulfill({
        json: { data: { ...candidate, email: accountState.email, emailVerified: true } },
      });
    }
    if (path.endsWith('/account/email-change-requests') && route.request().method() === 'POST') {
      const input = route.request().postDataJSON() as { email: string };
      accountState = { ...accountState, email: input.email };
      return route.fulfill({
        json: {
          data: { status: 'updated', ...candidate, email: input.email, emailVerified: true },
        },
      });
    }
    if (path.endsWith('/candidate/export')) {
      return route.fulfill({
        json: {
          data: {
            profile: accountState.profile,
            relocationQuestionnaire: relocationProfile,
            relocationConsent,
          },
        },
      });
    }
    if (path.endsWith('/candidate/me') && route.request().method() === 'DELETE') {
      return route.fulfill({ json: { data: { deleted: true } } });
    }
    if (path.endsWith('/candidate/consultant-history')) {
      return route.fulfill({ json: { data: [], meta: { nextCursor: null } } });
    }
    const historyConversation = path.match(
      /\/candidate\/consultant-history\/([^/]+)(?:\/messages)?$/u,
    );
    if (historyConversation) {
      if (route.request().method() === 'DELETE') return route.fulfill({ status: 204 });
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: 'conversation_read_only',
              message: 'Продолжить беседу из истории нельзя.',
            },
          },
        });
      }
      return route.fulfill({
        json: {
          data: {
            id: decodeURIComponent(historyConversation[1]!),
            stage: 'profile',
            openedAt: '2026-10-01T10:00:00.000Z',
            lastMessageAt: '2026-10-01T10:05:00.000Z',
            closedAt: '2026-10-01T10:06:00.000Z',
            messageCount: 2,
            firstPhrase: 'Расскажите о вашем опыте.',
            summary: null,
            messages: [],
          },
        },
      });
    }
    if (path.endsWith('/account')) {
      return route.fulfill({ json: { data: accountState } });
    }
    if (
      path.endsWith('/candidate/me/memory') ||
      path.endsWith('/candidate/me/turns') ||
      path.endsWith('/candidate/me/messages')
    ) {
      return route.fulfill({ json: { data: [], meta: { nextOffset: null } } });
    }
    if (path.endsWith('/candidate/role-hypotheses')) {
      return route.fulfill({ json: { data: roleHypotheses } });
    }
    if (path.endsWith('/candidate/resume')) {
      // B248, owner review 2026-09-23 — this shape used to disagree with
      // `ResumeStudioProjection`/`ResumeEvidenceFreshness`
      // (`server/domain/resumeStudioTypes.ts`): `evidenceFreshness.stale`
      // is an array the surface calls `.length` on, not a boolean, and it
      // crashed into the error boundary the moment «Профиль» started
      // opening this screen instead of a copy of «Сегодня». The client
      // rebuilds its own projection from the draft and never reads this
      // one, but the shape still has to be honest.
      const emptyDocument = {
        kind: 'master',
        targetRole: null,
        contact: { fullName: null, email: null, phone: null, location: null, links: [] },
        experience: [],
        education: [],
        languages: [],
        unknowns: [],
        conventions: {
          country: null,
          packVersion: null,
          reverseChronological: true,
          maxPages: null,
          recommendedBulletsPerRole: null,
          photo: 'omitted',
          discriminatoryPii: 'omitted',
        },
        length: { lines: 0, pages: 1, linesPerPage: 45 },
      };
      return route.fulfill({
        json: {
          data: {
            draft: profileSnapshot.resume?.draft ?? candidateSnapshot.resume.draft,
            savedAt: {
              createdAt: profileSnapshot.resume?.createdAt ?? candidateSnapshot.resume.createdAt,
              updatedAt: profileSnapshot.resume?.updatedAt ?? candidateSnapshot.resume.updatedAt,
            },
            projection: {
              master: emptyDocument,
              germanyVariant: { ...emptyDocument, kind: 'country-role' },
              evidenceSnapshot: [],
              excludedEvidenceIds: [],
            },
            evidenceFreshness: { valid: true, stale: [] },
          },
        },
      });
    }
    if (options.firstVacancyFitView && /\/candidate\/vacancies\/[^/]+\/fit$/u.test(path)) {
      return route.fulfill({ json: { data: options.firstVacancyFitView } });
    }
    if (path.endsWith('/candidate/matched-vacancies')) {
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const page = withFirstFitView(
        matchedVacancyPage(offset, options.vacancyTotal),
        offset,
        options.firstVacancyFitView,
      );
      return route.fulfill({
        json: {
          ...page,
          ...(offset === 0 && options.vacancyInitialFilters
            ? { data: seedInitialVacancyItems(page.data) }
            : {}),
          meta: {
            ...page.meta,
            ...(options.vacancyFacets ? { facets: options.vacancyFacets } : {}),
            ...(offset === 0 && options.vacancyInitialFilters
              ? { initialFilters: options.vacancyInitialFilters }
              : {}),
          },
        },
      });
    }
    if (
      path.endsWith('/candidate/vacancy-subscriptions') ||
      path.endsWith('/candidate/vacancy-sources') ||
      path.endsWith('/candidate/vacancy-applications') ||
      path.endsWith('/candidate/career-commands')
    ) {
      return route.fulfill({ json: { data: [] } });
    }
    if (/\/candidate\/connections\/(linkedin|hh)\/walk$/u.test(path)) {
      // B541: the walk copy is a convenience write; the cabinet ignores its body.
      return route.fulfill({ json: { data: route.request().postDataJSON() ?? {} } });
    }
    if (path.endsWith('/candidate/connections')) {
      return route.fulfill({ json: { data: options.accountConnections ?? [] } });
    }
    if (path.endsWith('/me/consents') && route.request().method() === 'GET') {
      return route.fulfill({ json: { data: { consents: [] } } });
    }
    if (path.includes('/me/consents/') && route.request().method() === 'DELETE') {
      return route.fulfill({ json: { data: { granted: false, revoked: true, consent: null } } });
    }
    if (path.includes('/me/consents/') && route.request().method() === 'POST') {
      return route.fulfill({
        status: 409,
        json: {
          error: {
            code: 'consent_text_not_approved',
            message: 'Текст согласия пока не утверждён.',
          },
        },
      });
    }
    if (
      path.endsWith('/candidate/strategy') ||
      path.endsWith('/candidate/work-preferences') ||
      path.endsWith('/candidate/reputation-audit') ||
      path.endsWith('/candidate/desktop-tunnel')
    ) {
      return route.fulfill({ json: { data: null } });
    }
    unmatched.push(path);
    return route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
  });
  await mockCandidateCompanies(page, {
    ...options.companyDirectory,
    companyCount: options.companyCount,
  });
  await mockInterviewSimulatorRoutes(page);
  return unmatched;
}

function applyMockCompanyWant(
  wants: Array<{
    companyKey: string;
    companyName: string;
    nextStep: string | null;
    nextStepDueAt: string | null;
    updatedAt: string;
  }>,
  company: Record<string, unknown>,
  action: string,
): void {
  const companyName = String(company.companyName ?? '')
    .trim()
    .replace(/\s+/gu, ' ');
  const normalized = companyName.normalize('NFKC').toLocaleLowerCase('und');
  const index = wants.findIndex(
    (want) => want.companyName.normalize('NFKC').toLocaleLowerCase('und') === normalized,
  );
  if (action === 'add' && index < 0) {
    wants.push({
      companyKey: `mock:${normalized}`,
      companyName,
      nextStep: null,
      nextStepDueAt: null,
      updatedAt: new Date().toISOString(),
    });
  }
  if (action === 'set_next_step' && index >= 0) {
    wants[index]!.nextStep = String(company.nextStep ?? '');
    wants[index]!.nextStepDueAt = company.nextStepDueAt ? String(company.nextStepDueAt) : null;
    wants[index]!.updatedAt = new Date().toISOString();
  }
  if (action === 'remove' && index >= 0) wants.splice(index, 1);
}

function checkoutResponse(invoice: FixtureInvoice) {
  return {
    invoiceId: invoice.invoiceId,
    planId: invoice.planId,
    amountKopecks: invoice.amountKopecks,
    currency: invoice.currency,
    status: invoice.status,
    autoRenew: invoice.autoRenew,
    paymentUrl: invoice.paymentUrl,
    createdAt: invoice.createdAt,
  };
}

function buildFixtureRelocationAlerts(
  profile: Record<string, unknown> | null,
  consentGranted: boolean,
) {
  return consentGranted && profile
    ? buildRelocationAlerts(profile as unknown as RelocationQuestionnaire, '2026-10-14')
    : [];
}

function emptyRelocationProfile(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    revision: 0,
    currentStep: 'citizenship_documents',
    skippedSteps: [],
    citizenshipDocuments: { citizenshipCountryCodes: [], documents: [] },
    education: { education: [], certificates: [] },
    family: {
      partnerStatus: 'unknown',
      relocationTimeframe: 'unknown',
      familyMovePlan: 'undecided',
    },
    languages: { languages: [] },
    updatedAt: null,
  };
}
