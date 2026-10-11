import type { Page, Route } from '@playwright/test';
import type { MatchedVacancyFacets } from '../../shared/matchedVacancyFacets';
import type { VacanciesScreenState } from '../../src/features/vacancies/VacanciesScreenFilters';
import { mockCandidateCompanies } from './mockCandidateCompanies';
import {
  account,
  candidate,
  candidateSnapshot,
  matchedVacancyPage,
  roleHypotheses,
  todaySnapshot,
  workspace,
} from './readabilityWorkspace';

interface ApplicationStub {
  readonly id: string;
  readonly candidateId: string;
  readonly clusterId: string | null;
  stage: string;
  archivePreviousStage: string | null;
  version: number;
  readonly vacancy: unknown;
  readonly createdAt: string;
  updatedAt: string;
}

export interface MockSignedInCabinetOptions {
  readonly vacancyTotal?: number;
  readonly vacancyFacets?: MatchedVacancyFacets;
  readonly vacancyInitialFilters?: VacanciesScreenState;
  readonly savedVacanciesCount?: number;
  readonly companyCount?: number;
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
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  });
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

export interface MockSignedInCabinetOptions {
  readonly candidateId?: string;
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
  readonly linkedinDrafts?: readonly Record<string, unknown>[];
  readonly linkedinDraftTopics?: readonly Record<string, unknown>[];
  readonly linkedinDraftCadence?: Partial<LinkedinDraftFixtureState['cadence']>;
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
    candidateId,
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
    const changed = { ...existing, ...update, updatedAt: new Date().toISOString() };
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
          circles: [
            { circle: 1, state: knownState, paths: [] },
            { circle: 2, state: knownState, paths: [] },
            { circle: 3, state: 'available', paths: [{ nextStep: 'cold_application' }] },
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
  const automation = createAutomationFixtureState(options);
  const linkedinDrafts = createLinkedinDraftFixtureState(options);
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
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
    if (path.endsWith('/candidate/today')) {
      const existingMomentum =
        'momentum' in todaySnapshot
          ? (todaySnapshot as { momentum?: unknown }).momentum
          : undefined;
      const snapshotWithMomentum = {
        ...todaySnapshot,
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
    if (path.endsWith('/candidate/footprint')) {
      return route.fulfill({ json: { data: { audit: null } } });
    }
    if (path.endsWith('/candidate/visits') && route.request().method() === 'POST') {
      return route.fulfill({ json: { data: { since: null } } });
    }
    if (path.endsWith('/candidate/me')) {
      return route.fulfill({
        json: {
          data: candidateSnapshot,
          meta: { memory: { nextOffset: null }, turns: { nextOffset: null } },
        },
      });
    }
    if (path.endsWith('/account/sessions') && route.request().method() === 'DELETE') {
      return route.fulfill({ json: { data: { revoked: 2 } } });
    }
    if (path.endsWith('/candidate/export')) {
      return route.fulfill({ json: { data: { profile: account.profile } } });
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
      return route.fulfill({ json: { data: account } });
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
            draft: candidateSnapshot.resume.draft,
            savedAt: {
              createdAt: candidateSnapshot.resume.createdAt,
              updatedAt: candidateSnapshot.resume.updatedAt,
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
    if (path.endsWith('/candidate/matched-vacancies')) {
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const page = matchedVacancyPage(offset, options.vacancyTotal);
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
      path.endsWith('/candidate/connections') ||
      path.endsWith('/candidate/career-commands')
    ) {
      return route.fulfill({ json: { data: [] } });
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
  await mockCandidateCompanies(page, { companyCount: options.companyCount });
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
